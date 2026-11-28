import re
import stat
import textwrap
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock


WORKFLOW_PATH = (
    Path(__file__).resolve().parents[1]
    / ".github"
    / "workflows"
    / "deploy-hanouti-pos-vps.yml"
)


def extract_remote_deploy_script(workflow):
    match = re.search(
        r"<<'REMOTE_DEPLOY'\s*\n(.*?)^\s*REMOTE_DEPLOY\s*$",
        workflow,
        re.MULTILINE | re.DOTALL,
    )
    if match is None:
        raise AssertionError("Could not find the remote deployment script.")
    return textwrap.dedent(match.group(1))


def extract_nginx_checker(deploy_script):
    match = re.search(
        r"<<'PY_NGINX_ACCESS'\s*\n(.*?)^\s*PY_NGINX_ACCESS\s*$",
        deploy_script,
        re.MULTILINE | re.DOTALL,
    )
    if match is None:
        raise AssertionError("Could not find the Nginx access checker.")
    return textwrap.dedent(match.group(1))


class FrontendDeploymentPermissionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        workflow = WORKFLOW_PATH.read_text(encoding="utf-8")
        cls.deploy_script = extract_remote_deploy_script(workflow)
        cls.checker = extract_nginx_checker(cls.deploy_script)
        cls.checker_namespace = {"__name__": "frontend_deploy_permission_test"}
        exec(compile(cls.checker, str(WORKFLOW_PATH), "exec"), cls.checker_namespace)

    def test_normalizes_releases_created_with_restrictive_umask(self):
        restrictive_umask_directory_mode = 0o777 & ~0o077
        self.assertEqual(restrictive_umask_directory_mode, 0o700)

        create_directory = self.deploy_script.index('mkdir -- "$releases_dir"')
        normalize_directory = self.deploy_script.index(
            'chmod 0755 -- "$releases_dir"',
            create_directory,
        )
        verify_directory_mode = self.deploy_script.index(
            """[[ "$(stat -c '%a' -- "$releases_dir")" != "755" ]]""",
            normalize_directory,
        )
        self.assertLess(create_directory, normalize_directory)
        self.assertLess(normalize_directory, verify_directory_mode)

    def test_normalizes_release_tree_to_nginx_static_modes(self):
        self.assertIn('find "$release_tmp" -type d -exec chmod 755 {} +', self.deploy_script)
        self.assertIn('find "$release_tmp" -type f -exec chmod 644 {} +', self.deploy_script)
        self.assertIn('mkdir -m 0755 -- "$release_tmp"', self.deploy_script)

    def test_checks_www_data_access_before_atomic_activation(self):
        nginx_check = self.deploy_script.index("<<'PY_NGINX_ACCESS'")
        current_switch = self.deploy_script.index('mv -Tf -- "$current_tmp" "$current_link"')
        self.assertLess(nginx_check, current_switch)
        self.assertIn('pwd.getpwnam("www-data")', self.checker)
        self.assertIn('require_directory_chain(release_dir, nginx_user.pw_uid, group_ids)', self.checker)
        self.assertIn('require_release_tree(release_dir, nginx_user.pw_uid, group_ids)', self.checker)
        self.assertIn('{"index.html", "version.json"}', self.checker)

    def test_permission_check_uses_nginx_owner_group_or_other_class(self):
        permission_bits_for = self.checker_namespace["permission_bits_for"]

        owner_directory = stat.S_IFDIR | 0o700
        group_directory = stat.S_IFDIR | 0o750
        other_file = stat.S_IFREG | 0o644
        private_directory = stat.S_IFDIR | 0o700

        self.assertEqual(permission_bits_for(
            SimpleNamespace(st_mode=owner_directory, st_uid=33, st_gid=33),
            33,
            {33},
        ) & 1, 1)
        self.assertEqual(permission_bits_for(
            SimpleNamespace(st_mode=group_directory, st_uid=1001, st_gid=33),
            33,
            {33},
        ) & 1, 1)
        self.assertEqual(permission_bits_for(
            SimpleNamespace(st_mode=other_file, st_uid=1001, st_gid=1001),
            33,
            {33},
        ) & 4, 4)
        self.assertEqual(permission_bits_for(
            SimpleNamespace(st_mode=private_directory, st_uid=1001, st_gid=1001),
            33,
            {33},
        ) & 1, 0)

    def test_release_tree_requires_readable_files_and_traversable_directories(self):
        release_dir = "C:\\temp\\release"
        entries = {
            release_dir: SimpleNamespace(
                st_mode=stat.S_IFDIR | 0o755,
                st_uid=1001,
                st_gid=1001,
            ),
            str(Path(release_dir) / "index.html"): SimpleNamespace(
                st_mode=stat.S_IFREG | 0o644,
                st_uid=1001,
                st_gid=1001,
                st_size=16,
            ),
            str(Path(release_dir) / "version.json"): SimpleNamespace(
                st_mode=stat.S_IFREG | 0o644,
                st_uid=1001,
                st_gid=1001,
                st_size=32,
            ),
        }

        def lstat(path):
            return entries[path]

        walk = [(release_dir, [], ["index.html", "version.json"])]
        require_release_tree = self.checker_namespace["require_release_tree"]

        with mock.patch("os.lstat", side_effect=lstat), mock.patch("os.walk", return_value=walk):
            require_release_tree(release_dir, 33, {33})

        entries[str(Path(release_dir) / "index.html")].st_mode = stat.S_IFREG | 0o600
        with mock.patch("os.lstat", side_effect=lstat), mock.patch("os.walk", return_value=walk):
            with self.assertRaisesRegex(RuntimeError, "unsafe static file"):
                require_release_tree(release_dir, 33, {33})


if __name__ == "__main__":
    unittest.main()
