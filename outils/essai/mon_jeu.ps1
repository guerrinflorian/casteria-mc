# Trouve (ou ferme proprement) le jeu lance par le test : SEULEMENT un java/javaw dont la ligne de commande
# contient « test-launcher ». Ne touche jamais aux autres Java (TLauncher de Florian, essais des autres sessions).
# Usage : powershell -File mon_jeu.ps1 trouver | fermer
param([Parameter(Mandatory = $true)][ValidateSet('trouver', 'fermer')][string]$Action)

$miens = Get-CimInstance Win32_Process -Filter "Name='javaw.exe' OR Name='java.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine -like '*test-launcher*' }

if (-not $miens) { Write-Output "AUCUN"; exit 0 }

foreach ($m in $miens) {
    $p = Get-Process -Id $m.ProcessId -ErrorAction SilentlyContinue
    if (-not $p) { continue }
    $mo = [int]($p.WorkingSet64 / 1MB)
    if ($Action -eq 'trouver') {
        Write-Output ("PID {0} {1} {2} Mo fenetre='{3}'" -f $p.Id, $p.ProcessName, $mo, $p.MainWindowTitle)
    } else {
        # WM_CLOSE sur la fenetre : le jeu s'arrete comme avec le bouton Quitter (sauvegarde des options).
        $ok = $p.CloseMainWindow()
        Write-Output ("FERMETURE demandee PID {0} ({1}) : {2}" -f $p.Id, $p.MainWindowTitle, $ok)
    }
}
