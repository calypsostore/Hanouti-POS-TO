package com.hanouti.pos;

import android.content.Intent;
import android.net.Uri;

import androidx.core.content.FileProvider;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.IOException;

@CapacitorPlugin(name = "ApkInstaller")
public class ApkInstallerPlugin extends Plugin {
    @PluginMethod
    public void installApk(PluginCall call) {
        String path = call.getString("path");
        if (path == null || !path.toLowerCase().endsWith(".apk")) {
            call.reject("A downloaded APK path is required.");
            return;
        }

        try {
            File apkFile = new File(path).getCanonicalFile();
            File cacheDirectory = getContext().getCacheDir().getCanonicalFile();
            if (!apkFile.getPath().startsWith(cacheDirectory.getPath() + File.separator) || !apkFile.isFile()) {
                call.reject("The APK must be a downloaded file in the app cache.");
                return;
            }

            Uri apkUri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                apkFile
            );
            Intent installIntent = new Intent(Intent.ACTION_VIEW);
            installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(installIntent);
            call.resolve();
        } catch (IOException | RuntimeException error) {
            call.reject("Could not open the Android package installer.", error);
        }
    }
}
