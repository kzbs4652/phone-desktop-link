using System;
using System.Drawing;
using System.IO;
using System.Diagnostics;
using System.Windows.Forms;

public class SetupWizardForm : Form {
    private Label lblTitle;
    private Label lblSub;
    private Label lblStatus;
    private ProgressBar progressBar;
    private Button btnAction;
    private CheckBox chkLaunch;
    private Timer timer;
    private int progress = 0;
    private string targetExePath;
    private string targetWorkingDir;

    public SetupWizardForm() {
        this.Text = "KZBS PhoneLink v1.0.0 Kurulum Sihirbazi";
        this.Width = 600;
        this.Height = 460;
        this.StartPosition = FormStartPosition.CenterScreen;
        this.FormBorderStyle = FormBorderStyle.FixedDialog;
        this.MaximizeBox = false;
        this.BackColor = Color.FromArgb(10, 15, 29);
        this.ForeColor = Color.White;

        string baseDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\', '/');
        
        // Find pc-app\KZBS-PhoneLink.exe
        string[] candidates = new string[] {
            Path.Combine(baseDir, "pc-app", "KZBS-PhoneLink.exe"),
            Path.Combine(baseDir, "..", "pc-app", "KZBS-PhoneLink.exe"),
            Path.Combine(baseDir, "KZBS-PhoneLink.exe"),
            @"C:\Users\Acer\OneDrive\Masaüstü\PhoneLink\pc-app\KZBS-PhoneLink.exe"
        };

        foreach (string c in candidates) {
            if (File.Exists(c)) {
                targetExePath = Path.GetFullPath(c);
                targetWorkingDir = Path.GetDirectoryName(targetExePath);
                break;
            }
        }

        if (string.IsNullOrEmpty(targetExePath)) {
            targetExePath = Path.Combine(baseDir, "pc-app", "KZBS-PhoneLink.exe");
            targetWorkingDir = Path.Combine(baseDir, "pc-app");
        }

        // Header Banner Panel
        Panel header = new Panel {
            Dock = DockStyle.Top,
            Height = 96,
            BackColor = Color.FromArgb(18, 26, 43)
        };
        this.Controls.Add(header);

        lblTitle = new Label {
            Text = "KZBS PhoneLink v1.0.0",
            Font = new Font("Segoe UI", 16, FontStyle.Bold),
            ForeColor = Color.FromArgb(0, 242, 254),
            Location = new Point(24, 18),
            AutoSize = true
        };
        header.Controls.Add(lblTitle);

        lblSub = new Label {
            Text = "Telefon & Bilgisayar Akilli Yonetim Paketi Kurulumu",
            Font = new Font("Segoe UI", 10),
            ForeColor = Color.FromArgb(142, 142, 147),
            Location = new Point(26, 54),
            AutoSize = true
        };
        header.Controls.Add(lblSub);

        // Content Area
        Label lblInfo = new Label {
            Text = "Bu kurulum sihirbazi KZBS PhoneLink masaustu uygulamasini yapilandiracak,\nmasaustunuze ve baslat menusune bagimsiz masaustu kisayolunu ekleyecektir.\n\nUygulama konumu: " + targetWorkingDir,
            Font = new Font("Segoe UI", 9),
            Location = new Point(30, 120),
            Size = new Size(520, 60),
            ForeColor = Color.FromArgb(235, 235, 245)
        };
        this.Controls.Add(lblInfo);

        lblStatus = new Label {
            Text = "Kuruluma hazir. 'Kuruluma Basla' butonuna tiklayiniz.",
            Font = new Font("Segoe UI", 9, FontStyle.Italic),
            Location = new Point(30, 210),
            AutoSize = true,
            ForeColor = Color.FromArgb(0, 242, 254)
        };
        this.Controls.Add(lblStatus);

        progressBar = new ProgressBar {
            Location = new Point(30, 240),
            Size = new Size(520, 24),
            Value = 0,
            Maximum = 100
        };
        this.Controls.Add(progressBar);

        chkLaunch = new CheckBox {
            Text = "Kurulum tamamlandiginda KZBS PhoneLink uygulamasini baslat",
            Location = new Point(30, 285),
            AutoSize = true,
            Checked = true,
            Font = new Font("Segoe UI", 9),
            ForeColor = Color.FromArgb(200, 200, 210)
        };
        this.Controls.Add(chkLaunch);

        btnAction = new Button {
            Text = "Kuruluma Basla",
            Location = new Point(400, 345),
            Size = new Size(150, 42),
            BackColor = Color.FromArgb(0, 242, 254),
            ForeColor = Color.FromArgb(7, 11, 20),
            FlatStyle = FlatStyle.Flat,
            Font = new Font("Segoe UI", 10, FontStyle.Bold),
            Cursor = Cursors.Hand
        };
        btnAction.FlatAppearance.BorderSize = 0;
        btnAction.Click += BtnAction_Click;
        this.Controls.Add(btnAction);

        timer = new Timer();
        timer.Interval = 35;
        timer.Tick += Timer_Tick;
    }

    private void BtnAction_Click(object sender, EventArgs e) {
        if (btnAction.Text == "Kuruluma Basla") {
            btnAction.Enabled = false;
            timer.Start();
        } else if (btnAction.Text == "Bitir ve Baslat" || btnAction.Text == "Kapat") {
            if (chkLaunch.Checked && File.Exists(targetExePath)) {
                ProcessStartInfo psi = new ProcessStartInfo {
                    FileName = targetExePath,
                    WorkingDirectory = targetWorkingDir,
                    Arguments = ""
                };
                Process.Start(psi);
            }
            this.Close();
        }
    }

    private void Timer_Tick(object sender, EventArgs e) {
        progress += 4;
        if (progress <= 35) {
            lblStatus.Text = "Sistem bilesenleri ve paketler dogrulaniyor...";
        } else if (progress <= 75) {
            lblStatus.Text = "Bagimsiz masaustu calistiricisi yapilandiriliyor...";
        } else if (progress <= 95) {
            lblStatus.Text = "Masaustu ve Baslat Menusu kisayollari olusturuluyor...";
        }

        if (progress >= 100) {
            timer.Stop();
            progressBar.Value = 100;
            CreateShortcuts();
            lblStatus.Text = "Tebrikler! KZBS PhoneLink basariyla kuruldu.";
            lblStatus.ForeColor = Color.FromArgb(48, 209, 88);
            btnAction.Text = chkLaunch.Checked ? "Bitir ve Baslat" : "Kapat";
            btnAction.BackColor = Color.FromArgb(48, 209, 88);
            btnAction.Enabled = true;
        } else {
            progressBar.Value = progress;
        }
    }

    private void CreateShortcuts() {
        try {
            string desktopDir = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            string desktopShortcut = Path.Combine(desktopDir, "KZBS PhoneLink.lnk");

            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            dynamic shell = Activator.CreateInstance(shellType);
            dynamic shortcut = shell.CreateShortcut(desktopShortcut);
            shortcut.TargetPath = targetExePath;
            shortcut.WorkingDirectory = targetWorkingDir;
            shortcut.Description = "KZBS PhoneLink v1.0.0 Telefon & Bilgisayar Yonetim Sistemi";
            shortcut.Save();

            // Start menu shortcut
            string startMenuDir = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
            string startMenuShortcut = Path.Combine(startMenuDir, "KZBS PhoneLink.lnk");
            dynamic startShortcut = shell.CreateShortcut(startMenuShortcut);
            startShortcut.TargetPath = targetExePath;
            startShortcut.WorkingDirectory = targetWorkingDir;
            startShortcut.Description = "KZBS PhoneLink v1.0.0";
            startShortcut.Save();
        } catch {
            // Ignore COM errors
        }
    }

    [STAThread]
    static void Main() {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new SetupWizardForm());
    }
}
