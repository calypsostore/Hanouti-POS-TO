import importlib.util
import io
import json
import re
import stat
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


MODULE_PATH = Path(__file__).parents[1] / "scripts" / "vps-admin" / "hanouti_pos_admin.py"
SPEC = importlib.util.spec_from_file_location("hanouti_pos_admin", MODULE_PATH)
ADMIN = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(ADMIN)


def compose_document():
    services = {}
    for service, container in ADMIN.CONTAINERS.items():
        mounts = []
        for target, (volume_key, read_write) in ADMIN.VOLUME_MOUNTS.get(service, {}).items():
            mounts.append(
                {
                    "type": "volume",
                    "source": volume_key,
                    "target": target,
                    "read_only": not read_write,
                }
            )
        for source, target in ADMIN.BIND_MOUNTS.get(service, {}).items():
            mounts.append(
                {
                    "type": "bind",
                    "source": str(ADMIN.COMPOSE_DIR / source),
                    "target": target,
                    "read_only": True,
                }
            )
        services[service] = {
            "container_name": container,
            "image": ADMIN.IMAGES[service],
            "networks": {"supabase": None},
            "volumes": mounts,
            "ports": [],
        }
    services["kong"]["ports"] = [
        {
            "host_ip": "127.0.0.1",
            "published": "8000",
            "target": 8000,
            "protocol": "tcp",
        }
    ]
    services["studio"]["ports"] = [
        {
            "host_ip": "127.0.0.1",
            "published": "3003",
            "target": 3000,
            "protocol": "tcp",
        }
    ]
    return {
        "name": ADMIN.PROJECT,
        "services": services,
        "volumes": {
            key: {"name": name, "external": False}
            for key, name in ADMIN.VOLUMES.items()
        },
        "networks": {
            "supabase": {
                "name": ADMIN.NETWORK_NAME,
                "driver": "bridge",
                "external": False,
            }
        },
    }


class ParseRequestTests(unittest.TestCase):
    def test_powershell_action_and_service_allowlists_match_the_helper(self):
        client = (MODULE_PATH.parent / "hanouti-pos-admin.ps1").read_text(
            encoding="utf-8"
        )
        blocks = re.findall(
            r"\[ValidateSet\((.*?)\)\]\s*\[string\]\$(Action|Service)",
            client,
            re.S,
        )
        allowlists = {
            name: set(re.findall(r"'([^']+)'", block))
            for block, name in blocks
        }
        self.assertEqual(allowlists.get("Action"), ADMIN.ALLOWED_ACTIONS)
        self.assertEqual(allowlists.get("Service"), set(ADMIN.CONTAINERS))

    def test_accepts_fixed_actions_and_allowlisted_restart_service(self):
        for action in ADMIN.ALLOWED_ACTIONS - ADMIN.SERVICE_ACTIONS:
            request = ADMIN.parse_request(
                json.dumps({"action": action}).encode("ascii") + b"\n"
            )
            self.assertEqual(request["action"], action)
        request = ADMIN.parse_request(b'{"action":"compose-restart","service":"db"}\n')
        self.assertEqual(request["service"], "db")
        request = ADMIN.parse_request(
            b'{"action":"compose-log-summary","service":"auth"}\n'
        )
        self.assertEqual(request["service"], "auth")

    def test_rejects_unknown_or_store_targets_and_shell_fields(self):
        invalid = (
            b'{"action":"shell","command":"id"}\n',
            b'{"action":"compose-stop","service":"hanouti-stores"}\n',
            b'{"action":"compose-restart","service":"hanouti-stores"}\n',
            b'{"action":"compose-log-summary","service":"hanouti-stores"}\n',
            b'{"action":"compose-restart","service":"db","command":"id"}\n',
            b'{"action":"compose-restart"}\n',
            b'{"action":"compose-log-summary"}\n',
            b'{"action":"host-status","action":"compose-stop"}\n',
            b'{"action":"nginx-reload"}\n',
            b'{"action":"compose-stop"}\n{"action":"compose-up"}\n',
        )
        for request in invalid:
            with self.subTest(request=request):
                with self.assertRaises(ValueError):
                    ADMIN.parse_request(request)

    def test_rejects_oversized_and_unframed_requests(self):
        with self.assertRaises(ValueError):
            ADMIN.parse_request(b'{"action":"host-status"}')
        with self.assertRaises(ValueError):
            ADMIN.parse_request(b"x" * (ADMIN.MAX_REQUEST_BYTES + 1) + b"\n")


class ComposeIsolationTests(unittest.TestCase):
    def validate_compose(self, document):
        with patch.object(Path, "resolve", lambda path, strict=False: path):
            ADMIN.validate_compose_document(document)

    def test_accepts_only_the_expected_pos_project(self):
        self.validate_compose(compose_document())

    def test_functions_pointer_must_target_a_root_owned_release(self):
        root = Path("C:/hanouti-pos")
        pointer = root / "volumes/functions/current"
        release = root / "volumes/functions/releases/release-1"
        link_info = SimpleNamespace(st_mode=stat.S_IFLNK | 0o777, st_uid=0)
        directory_info = SimpleNamespace(st_mode=stat.S_IFDIR | 0o755, st_uid=0)

        with (
            patch.object(ADMIN, "COMPOSE_DIR", root),
            patch.object(Path, "lstat", return_value=link_info),
            patch.object(Path, "resolve", return_value=release),
            patch.object(Path, "stat", return_value=directory_info),
            patch.object(ADMIN, "_validate_functions_release_tree"),
        ):
            ADMIN._validate_functions_pointer(pointer)

        outside = root / "volumes/functions/other/release-1"
        with (
            patch.object(ADMIN, "COMPOSE_DIR", root),
            patch.object(Path, "lstat", return_value=link_info),
            patch.object(Path, "resolve", return_value=outside),
            patch.object(Path, "stat", return_value=directory_info),
            patch.object(ADMIN, "_validate_functions_release_tree"),
        ):
            with self.assertRaises(ADMIN.AdminError):
                ADMIN._validate_functions_pointer(pointer)

        nested = release / "nested"
        with (
            patch.object(ADMIN, "COMPOSE_DIR", root),
            patch.object(Path, "lstat", return_value=link_info),
            patch.object(Path, "resolve", return_value=nested),
            patch.object(Path, "stat", return_value=directory_info),
            patch.object(ADMIN, "_validate_functions_release_tree"),
        ):
            with self.assertRaises(ADMIN.AdminError):
                ADMIN._validate_functions_pointer(pointer)

    def test_function_release_tree_rejects_symlinks_and_incomplete_packages(self):
        release = Path("/opt/hanouti-pos/functions/releases/test")
        with (
            patch.object(ADMIN.os, "walk", return_value=[]),
            self.assertRaisesRegex(ADMIN.AdminError, "incomplete"),
        ):
            ADMIN._validate_functions_release_tree(release)

        link_info = SimpleNamespace(st_mode=stat.S_IFLNK | 0o777, st_uid=0)
        with (
            patch.object(
                ADMIN.os,
                "walk",
                return_value=[(str(release), ["linked-dir"], [])],
            ),
            patch.object(Path, "lstat", return_value=link_info),
            self.assertRaisesRegex(ADMIN.AdminError, "unsafe directory"),
        ):
            ADMIN._validate_functions_release_tree(release)

    def test_rejects_unapproved_service_and_host_published_ports(self):
        document = compose_document()
        document["services"]["hanouti-stores"] = {}
        with self.assertRaises(ADMIN.AdminError):
            self.validate_compose(document)

        document = compose_document()
        document["services"]["rest"]["ports"] = [
            {
                "host_ip": "0.0.0.0",
                "published": "5432",
                "target": 5432,
                "protocol": "tcp",
            }
        ]
        with self.assertRaises(ADMIN.AdminError):
            self.validate_compose(document)

    def test_rejects_unapproved_volume_names_and_host_networking(self):
        document = compose_document()
        document["volumes"]["db-data"]["name"] = "hanouti-stores-db"
        with self.assertRaises(ADMIN.AdminError):
            self.validate_compose(document)

        document = compose_document()
        document["services"]["db"]["network_mode"] = "container:hanouti-stores-db"
        with self.assertRaises(ADMIN.AdminError):
            self.validate_compose(document)

        document = compose_document()
        document["services"]["db"]["use_api_socket"] = True
        with self.assertRaises(ADMIN.AdminError):
            self.validate_compose(document)

        document = compose_document()
        document["volumes"]["db-data"]["driver_opts"] = {
            "type": "none",
            "o": "bind",
            "device": "/srv/www/hanouti-stores.tn",
        }
        with self.assertRaises(ADMIN.AdminError):
            self.validate_compose(document)

        document = compose_document()
        document["secrets"] = {"unapproved": {}}
        with self.assertRaises(ADMIN.AdminError):
            self.validate_compose(document)

    def test_rejects_bind_mounts_outside_the_pos_tree(self):
        document = compose_document()
        document["services"]["db"]["volumes"] = [
            {
                "type": "bind",
                "source": "/srv/www/hanouti-stores.tn",
                "target": "/data",
            }
        ]
        with self.assertRaises(ADMIN.AdminError):
            self.validate_compose(document)

    def test_requires_exact_read_only_configuration_mounts(self):
        document = compose_document()
        document["services"]["db"]["volumes"][2]["read_only"] = False
        with self.assertRaises(ADMIN.AdminError):
            self.validate_compose(document)

    def test_existing_container_is_checked_beyond_spoofable_compose_labels(self):
        service = "rest"
        name = ADMIN.CONTAINERS[service]
        inspected = [
            {
                "Name": f"/{name}",
                "Config": {
                    "Image": ADMIN.IMAGES[service],
                    "Labels": {
                        "com.docker.compose.project": ADMIN.PROJECT,
                        "com.docker.compose.service": service,
                    },
                },
                "HostConfig": {
                    "Privileged": False,
                    "NetworkMode": ADMIN.NETWORK_NAME,
                    "PidMode": "",
                    "IpcMode": "private",
                    "UTSMode": "",
                    "Devices": [],
                    "CapAdd": None,
                    "PortBindings": {},
                },
                "Mounts": [],
                "NetworkSettings": {"Networks": {ADMIN.NETWORK_NAME: {}}},
            }
        ]
        with patch.object(
            ADMIN,
            "_run",
            return_value=SimpleNamespace(
                returncode=0, stdout=json.dumps(inspected), stderr=""
            ),
        ):
            ADMIN._verify_existing_container(service, name)

        inspected[0]["Mounts"] = [
            {
                "Type": "bind",
                "Source": "/srv/www/hanouti-stores.tn",
                "Destination": "/data",
                "RW": True,
            }
        ]
        with (
            patch.object(
                ADMIN,
                "_run",
                return_value=SimpleNamespace(
                    returncode=0, stdout=json.dumps(inspected), stderr=""
                ),
            ),
            self.assertRaises(ADMIN.AdminError),
        ):
            ADMIN._verify_existing_container(service, name)

    def test_existing_named_volume_must_be_local_and_project_owned(self):
        metadata = [
            {
                "Name": ADMIN.VOLUMES["db-data"],
                "Driver": "local",
                "Options": {"device": "/srv/www/hanouti-stores.tn"},
                "Labels": {"com.docker.compose.project": ADMIN.PROJECT},
            }
        ]
        with (
            patch.object(
                ADMIN,
                "_run",
                return_value=SimpleNamespace(
                    returncode=0, stdout=json.dumps(metadata), stderr=""
                ),
            ),
            self.assertRaises(ADMIN.AdminError),
        ):
            ADMIN._verify_volume_resource(ADMIN.VOLUMES["db-data"])


class DiagnosticTests(unittest.TestCase):
    def test_log_summary_never_prints_log_contents(self):
        private_log_text = "ERROR token=super-secret-value"
        with (
            patch.object(ADMIN, "_existing_pos_containers", return_value=[("auth", "hanouti-supabase-auth")]),
            patch.object(
                ADMIN,
                "_run",
                return_value=SimpleNamespace(returncode=0, stdout=private_log_text, stderr=""),
            ),
            redirect_stdout(io.StringIO()) as output,
        ):
            ADMIN._report_log_summary("auth")

        self.assertNotIn("super-secret-value", output.getvalue())
        self.assertNotIn("token=", output.getvalue())
        self.assertIn("auth_log_lines=1 errors=1 warnings=0", output.getvalue())

    def test_compose_health_reports_validated_state_and_health(self):
        with (
            patch.object(ADMIN, "_existing_pos_containers", return_value=[("db", "hanouti-supabase-db")]),
            patch.object(
                ADMIN,
                "_run",
                side_effect=[
                    SimpleNamespace(returncode=0, stdout="running|healthy\n", stderr=""),
                    SimpleNamespace(returncode=0, stdout="0.5%|23MiB / 1GiB|2.2%\n", stderr=""),
                ],
            ),
            redirect_stdout(io.StringIO()) as output,
        ):
            ADMIN._report_compose_status()

        self.assertEqual(
            output.getvalue(),
            "db=running health=healthy cpu=0.5% memory=23MiB / 1GiB memory_percent=2.2%\n",
        )

    def test_frontend_pointer_must_be_a_deployment_owned_release(self):
        root = Path("/srv/www/hanouti-pos")
        releases = root / "releases"
        pointer = root / "current"
        release = releases / "release-1"
        link_info = SimpleNamespace(st_mode=stat.S_IFLNK | 0o777, st_uid=1001)
        directory_info = SimpleNamespace(st_mode=stat.S_IFDIR | 0o755, st_uid=1001)
        file_info = SimpleNamespace(st_mode=stat.S_IFREG | 0o644, st_uid=1001, st_size=1)

        with (
            patch.object(Path, "lstat", side_effect=[link_info, file_info, file_info]),
            patch.object(Path, "resolve", return_value=release),
            patch.object(Path, "stat", return_value=directory_info),
        ):
            self.assertEqual(ADMIN._frontend_target(pointer, releases, 1001), release)

        outside = root / "unrelated-release"
        with (
            patch.object(Path, "lstat", side_effect=[link_info, file_info, file_info]),
            patch.object(Path, "resolve", return_value=outside),
            patch.object(Path, "stat", return_value=directory_info),
        ):
            with self.assertRaises(ADMIN.AdminError):
                ADMIN._frontend_target(pointer, releases, 1001)

    def test_compose_pull_uses_only_the_validated_fixed_project(self):
        with (
            patch.object(ADMIN, "_load_compose_document"),
            patch.object(ADMIN, "_verify_resource_ownership"),
            patch.object(
                ADMIN,
                "_run",
                return_value=SimpleNamespace(returncode=0, stdout="", stderr=""),
            ) as run,
            redirect_stdout(io.StringIO()) as output,
        ):
            ADMIN._run_action({"action": "compose-pull"})

        self.assertEqual(run.call_args.args[0], ADMIN.compose_prefix() + ["pull"])
        self.assertIn("compose-pull=completed", output.getvalue())

    def test_memory_diagnostic_fails_explicitly_when_proc_data_is_missing(self):
        with (
            patch.object(ADMIN.shutil, "disk_usage", return_value=SimpleNamespace(free=100)),
            patch.object(Path, "read_text", side_effect=OSError("unavailable")),
        ):
            with self.assertRaisesRegex(ADMIN.AdminError, "memory information"):
                ADMIN._report_host_status()

    def test_endpoint_checks_use_only_fixed_https_urls_and_fail_closed(self):
        responses = [
            SimpleNamespace(returncode=0, stdout="200", stderr=""),
            SimpleNamespace(returncode=0, stdout="200", stderr=""),
            SimpleNamespace(returncode=0, stdout="500", stderr=""),
        ]
        with (
            patch.object(ADMIN, "_run", side_effect=responses) as run,
            redirect_stdout(io.StringIO()) as output,
        ):
            with self.assertRaises(ADMIN.AdminError):
                ADMIN._check_endpoints()

        requested_urls = [call.args[0][-1] for call in run.call_args_list]
        self.assertEqual(
            requested_urls,
            [
                "https://hanouti-pos.tn/",
                "https://hanouti-pos.tn/version.json",
                "https://hanouti-pos.tn/auth/v1/health",
            ],
        )
        self.assertIn("auth_health=http-500", output.getvalue())


class ActionDispatchTests(unittest.TestCase):
    def test_every_allowlisted_action_dispatches_only_to_fixed_helpers(self):
        requests = [
            {"action": action}
            for action in sorted(ADMIN.ALLOWED_ACTIONS - ADMIN.SERVICE_ACTIONS)
        ]
        requests.extend(
            [
                {"action": "compose-restart", "service": "db"},
                {"action": "compose-log-summary", "service": "db"},
            ]
        )
        successful = SimpleNamespace(returncode=0, stdout="", stderr="")
        with (
            patch.object(ADMIN, "_report_host_status") as host_status,
            patch.object(ADMIN, "_report_paths") as paths,
            patch.object(ADMIN, "_load_compose_document") as load_compose,
            patch.object(ADMIN, "_verify_resource_ownership", return_value={"db"}) as ownership,
            patch.object(ADMIN, "_check_host_port_collisions") as port_check,
            patch.object(ADMIN, "_report_compose_status") as compose_status,
            patch.object(ADMIN, "_report_log_summary") as log_summary,
            patch.object(
                ADMIN,
                "_existing_pos_containers",
                return_value=[("db", ADMIN.CONTAINERS["db"])],
            ),
            patch.object(ADMIN, "_check_endpoints") as endpoint_check,
            patch.object(ADMIN, "_report_frontend_status") as frontend_status,
            patch.object(ADMIN, "_report_certificate") as certificate_status,
            patch.object(ADMIN, "_run", return_value=successful) as run,
            redirect_stdout(io.StringIO()),
        ):
            for request in requests:
                ADMIN._run_action(request)

        host_status.assert_called_once_with()
        paths.assert_called_once_with()
        self.assertEqual(load_compose.call_count, 4)
        self.assertEqual(ownership.call_count, 3)
        self.assertEqual(port_check.call_count, 2)
        self.assertEqual(port_check.call_args_list[0].args[0], {"db"})
        self.assertEqual(port_check.call_args_list[1].args[0], {"db"})
        self.assertEqual(compose_status.call_count, 2)
        log_summary.assert_called_once_with("db")
        endpoint_check.assert_called_once_with()
        frontend_status.assert_called_once_with()
        certificate_status.assert_called_once_with()
        self.assertEqual(
            [call.args[0] for call in run.call_args_list],
            [
                ADMIN.compose_prefix() + ["pull"],
                [ADMIN.DOCKER, "stop", ADMIN.CONTAINERS["db"]],
                ADMIN.compose_prefix() + ["up", "--detach"],
                [
                    ADMIN.DOCKER,
                    "exec",
                    ADMIN.CONTAINERS["db"],
                    "pg_isready",
                    "-U",
                    "postgres",
                    "-h",
                    "127.0.0.1",
                    "-p",
                    "5432",
                ],
                [ADMIN.NGINX, "-t"],
                [ADMIN.DOCKER, "restart", ADMIN.CONTAINERS["db"]],
            ],
        )


if __name__ == "__main__":
    unittest.main()
