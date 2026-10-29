using System;
using System.Diagnostics;
using System.IO;

class AppLauncher {
    static void Main() {
        try {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string electronExe = Path.Combine(baseDir, "node_modules", "electron", "dist", "electron.exe");
            
            ProcessStartInfo psi = new ProcessStartInfo {
                FileName = File.Exists(electronExe) ? electronExe : "electron",
                Arguments = "\"" + baseDir + "\"",
                WorkingDirectory = baseDir,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            Process.Start(psi);
        } catch (Exception ex) {
            System.Windows.Forms.MessageBox.Show("Başlatma hatası: " + ex.Message, "KZBS PhoneLink");
        }
    }
}
