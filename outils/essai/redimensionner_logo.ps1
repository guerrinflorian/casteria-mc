# Réduit le logo de Casteria (PNG avec transparence) aux tailles demandées, en bicubique haute qualité.
# Usage : powershell -File redimensionner_logo.ps1 -Source <png> -Dossier <sortie> -Tailles 16,32,256
param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Dossier,
    [Parameter(Mandatory = $true)][string]$Tailles
)
# Avec powershell -File, une liste arrive en texte : « 16,32,256 » (une autre variable : $Tailles reste du texte).
$liste = @($Tailles.Split(',') | ForEach-Object { [int]$_.Trim() })
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force $Dossier | Out-Null
$img = [System.Drawing.Bitmap]::FromFile($Source)
foreach ($t in $liste) {
    $bmp = New-Object System.Drawing.Bitmap $t, $t, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    # WrapMode TileFlipXY : pas de liseré sombre sur les bords en réduisant
    $attr = New-Object System.Drawing.Imaging.ImageAttributes
    $attr.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
    $g.DrawImage($img, (New-Object System.Drawing.Rectangle 0, 0, $t, $t), 0, 0, $img.Width, $img.Height, [System.Drawing.GraphicsUnit]::Pixel, $attr)
    $g.Dispose()
    $sortie = Join-Path $Dossier ("logo-" + $t + ".png")
    $bmp.Save($sortie, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Output ("{0} ({1} octets)" -f $sortie, (Get-Item $sortie).Length)
}
$img.Dispose()
