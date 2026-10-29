using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;

class AppLauncher {
    [STAThread]
    static void Main() {
        string exePath = Assembly.GetExecutingAssembly().Location;
        string baseDir = Path.GetDirectoryName(exePath);
        string logFile = Path.Combine(baseDir, "launcher.log");

        try {
            string electronExe = Path.Combine(baseDir, "node_modules", "electron", "dist", "electron.exe");
            
            if (!File.Exists(electronExe)) {
                string parentDir = Path.GetDirectoryName(baseDir);
                string candidate = Path.Combine(parentDir, "node_modules", "electron", "dist", "electron.exe");
                if (File.Exists(candidate)) {
                    electronExe = candidate;
                    baseDir = parentDir;
                }
            }

            File.WriteAllText(logFile, "Starting KZBS PhoneLink...\nBaseDir: " + baseDir + "\nElectron: " + electronExe + "\nExists: " + File.Exists(electronExe) + "\n");

            if (!File.Exists(electronExe)) {
                System.Windows.Forms.MessageBox.Show("Electron motoru bulunamadı:\n" + electronExe, "KZBS PhoneLink");
                return;
            }

            ProcessStartInfo psi = new ProcessStartInfo {
                FileName = electronExe,
                Arguments = "\"" + baseDir + "\"",
                WorkingDirectory = baseDir,
                UseShellExecute = true
            };
            Process p = Process.Start(psi);
            File.AppendAllText(logFile, "Process started with ID: " + (p != null ? p.Id.ToString() : "null") + "\n");
        } catch (Exception ex) {
            File.AppendAllText(logFile, "ERROR: " + ex.ToString() + "\n");
            System.Windows.Forms.MessageBox.Show("KZBS PhoneLink başlatılamadı:\n" + ex.Message, "KZBS PhoneLink", System.Windows.Forms.MessageBoxButtons.OK, System.Windows.Forms.MessageBoxIcon.Error);
        }
    }
}
