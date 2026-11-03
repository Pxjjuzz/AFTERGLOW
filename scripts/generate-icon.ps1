Add-Type -AssemblyName System.Drawing

$assets = Join-Path $PSScriptRoot '..\assets'
New-Item -ItemType Directory -Force -Path $assets | Out-Null

$size = 256
$bitmap = New-Object System.Drawing.Bitmap($size, $size)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#07060B'))

# Soft violet halo behind the constellation.
for ($i = 28; $i -ge 1; $i--) {
  $radius = 22 + $i * 3.2
  $alpha = [Math]::Max(0, 3 + (28 - $i) * 0.18)
  $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb([int]$alpha, 155, 107, 255))
  $x = 128 - $radius
  $y = 128 - $radius
  $graphics.FillEllipse($brush, $x, $y, $radius * 2, $radius * 2)
  $brush.Dispose()
}

# Thin constellation edges.
$pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(88, 220, 203, 255), 1.5)
$points = @(
  @(66, 164),
  @(104, 86),
  @(154, 124),
  @(196, 62),
  @(188, 188)
)
for ($i = 0; $i -lt $points.Count - 1; $i++) {
  $graphics.DrawLine($pen, $points[$i][0], $points[$i][1], $points[$i + 1][0], $points[$i + 1][1])
}
$graphics.DrawLine($pen, $points[0][0], $points[0][1], $points[4][0], $points[4][1])
$pen.Dispose()

# Stars with a gentle glow.
$sizes = @(9.5, 7.5, 10.0, 6.5, 8.0)
for ($i = 0; $i -lt $points.Count; $i++) {
  $px = $points[$i][0]
  $py = $points[$i][1]
  $starSize = $sizes[$i]

  for ($glow = 5; $glow -ge 1; $glow--) {
    $glowAlpha = [int](7 * (6 - $glow))
    $glowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb($glowAlpha, 155, 107, 255))
    $glowRadius = $starSize + $glow * 4.2
    $graphics.FillEllipse($glowBrush, $px - $glowRadius, $py - $glowRadius, $glowRadius * 2, $glowRadius * 2)
    $glowBrush.Dispose()
  }

  $starBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(250, 238, 228, 255))
  $graphics.FillEllipse($starBrush, $px - $starSize / 2, $py - $starSize / 2, $starSize, $starSize)
  $starBrush.Dispose()

  if ($i -eq 2) {
    $rayPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(190, 220, 203, 255), 1.1)
    $graphics.DrawLine($rayPen, $px - 13, $py, $px + 13, $py)
    $graphics.DrawLine($rayPen, $px, $py - 13, $px, $py + 13)
    $rayPen.Dispose()
  }
}

$pngPath = Join-Path $assets 'icon.png'
$bitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()

Write-Output "Wrote $pngPath"
