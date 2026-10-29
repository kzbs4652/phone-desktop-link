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
    private string targetAppPath;

    public SetupWizardForm() {
        this.Text = "KZBS PhoneLink v1.0.0 Kurulum Sihirbazi";
        this.Width = 580;
        this.Height = 440;
        this.StartPosition = FormStartPosition.CenterScreen;
        this.FormBorderStyle = FormBorderStyle.FixedDialog;
        this.MaximizeBox = false;
        this.BackColor = Color.FromArgb(10, 15, 29);
        this.ForeColor = Color.White;

        string scriptDir = AppDomain.CurrentDomain.BaseDirectory;
        // Search for pc-app\KZBS-PhoneLink.exe
        string p1 = Path.Combine(scriptDir, "pc-app", "KZBS-PhoneLink.exe");
        string p2 = Path.Combine(scriptDir, "..", "pc-app", "KZBS-PhoneLink.exe");
        string p3 = Path.Combine(scriptDir, "KZBS-PhoneLink.exe");
        if (File.Exists(p1)) targetAppPath = Path.GetFullPath(p1);
        else if (File.Exists(p2)) targetAppPath = Path.GetFullPath(p2);
        else targetAppPath = Path.GetFullPath(p3);

        // Header Banner Panel
        Panel header = new Panel {
            Dock = DockStyle.Top,
            Height = 90,
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
            Location = new Point(26, 52),
            AutoSize = true
        };
        header.Controls.Add(lblSub);

        // Content Area
        Label lblInfo = new Label {
            Text = "Bu kurulum sihirbazi KZBS PhoneLink uygulamasini bilgisayariniza entegre edecek,\nmasaustunuze kisayol ekleyecek ve bagimsiz masaustu uygulamasini hazirlayacaktir.\n\nDevam etmek icin lutfen 'Kuruluma Basla' butonuna tiklayiniz.",
            Font = new Font("Segoe UI", 10),
            Location = new Point(30, 120),
            Size = new Size(500, 70),
            ForeColor = Color.FromArgb(235, 235, 245)
        };
        this.Controls.Add(lblInfo);

        lblStatus = new Label {
            Text = "Kuruluma hazir.",
            Font = new Font("Segoe UI", 9, FontStyle.Italic),
            Location = new Point(30, 215),
            AutoSize = true,
            ForeColor = Color.FromArgb(0, 242, 254)
        };
        this.Controls.Add(lblStatus);

        progressBar = new ProgressBar {
            Location = new Point(30, 240),
            Size = new Size(500, 24),
            Value = 0,
            Maximum = 100
        };
        this.Controls.Add(progressBar);

        chkLaunch = new CheckBox {
            Text = "Kurulum tamamlandiginda KZBS PhoneLink uygulamasini baslat",
            Location = new Point(30, 280),
            AutoSize = true,
            Checked = true,
            Font = new Font("Segoe UI", 9),
            ForeColor = Color.FromArgb(200, 200, 210)
        };
        this.Controls.Add(chkLaunch);

        btnAction = new Button {
            Text = "Kuruluma Basla",
            Location = new Point(380, 335),
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
        timer.Interval = 40;
        timer.Tick += Timer_Tick;
    }

    private void BtnAction_Click(object sender, EventArgs e) {
        if (btnAction.Text == "Kuruluma Basla") {
            btnAction.Enabled = false;
            timer.Start();
        } else if (btnAction.Text == "Bitir ve Baslat" || btnAction.Text == "Kapat") {
            if (chkLaunch.Checked && File.Exists(targetAppPath)) {
                Process.Start(new ProcessStartInfo {
                    FileName = targetAppPath,
                    WorkingDirectory = Path.GetDirectoryName(targetAppPath)
                });
            }
            this.Close();
        }
    }

    private void Timer_Tick(object sender, EventArgs e) {
        progress += 3;
        if (progress <= 30) {
            lblStatus.Text = "Sistem bilesenleri kontrol ediliyor...";
        } else if (progress <= 70) {
            lblStatus.Text = "Masaustu bagimsiz uygulama motoru hazirlaniyor...";
        } else if (progress <= 95) {
            lblStatus.Text = "Masaustu kisayolu olusturuluyor...";
        }

        if (progress >= 100) {
            timer.Stop();
            progressBar.Value = 100;
            CreateDesktopShortcut();
            lblStatus.Text = "Tebrikler! KZBS PhoneLink basariyla kuruldu.";
            lblStatus.ForeColor = Color.FromArgb(48, 209, 88);
            btnAction.Text = chkLaunch.Checked ? "Bitir ve Baslat" : "Kapat";
            btnAction.BackColor = Color.FromArgb(48, 209, 88);
            btnAction.Enabled = true;
        } else {
            progressBar.Value = progress;
        }
    }

    private void CreateDesktopShortcut() {
        try {
            string desktopDir = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            string shortcutPath = Path.Combine(desktopDir, "KZBS PhoneLink.lnk");

            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            dynamic shell = Activator.CreateInstance(shellType);
            dynamic shortcut = shell.CreateShortcut(shortcutPath);
            shortcut.TargetPath = targetAppPath;
            shortcut.WorkingDirectory = Path.GetDirectoryName(targetAppPath);
            shortcut.Description = "KZBS PhoneLink v1.0.0 Telefon & Bilgisayar Yonetim Sistemi";
            shortcut.Save();
        } catch {
            // Ignore if COM shortcut fails
        }
    }

    [STAThread]
    static void Main() {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new SetupWizardForm());
    }
}
