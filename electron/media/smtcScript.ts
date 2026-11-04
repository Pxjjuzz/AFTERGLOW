/**
 * The Windows media-session bridge is a small, self-contained PowerShell
 * helper. It talks to WinRT's GlobalSystemMediaTransportControlsSessionManager
 * (the same API Windows uses for its media flyout) and prints one compact JSON
 * line per poll. Running it as a child process avoids shipping a native Node
 * addon and keeps the Electron main process crash-isolated from WinRT.
 */
export const SMTC_HELPER_SCRIPT = String.raw`$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null

$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$mediaPropsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation*'
})[0]

function Await($operation, $resultType) {
  $task = $asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($operation))
  $task.Wait(-1) | Out-Null
  $task.Result
}

function Emit($payload) {
  [Console]::Out.WriteLine(($payload | ConvertTo-Json -Compress -Depth 6))
  [Console]::Out.Flush()
}

while ($true) {
  $at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  try {
    $manager = Await ($managerType::RequestAsync()) $managerType
    $sessions = @()

    foreach ($session in $manager.GetSessions()) {
      try {
        $props = Await ($session.TryGetMediaPropertiesAsync()) $mediaPropsType
        $timeline = $session.GetTimelineProperties()
        $info = $session.GetPlaybackInfo()
        $status = 'unknown'
        if ($info) { $status = $info.PlaybackStatus.ToString().ToLowerInvariant() }

        $position = 0.0
        $duration = 0.0
        if ($timeline) {
          $position = $timeline.Position.TotalSeconds
          $duration = ($timeline.EndTime - $timeline.StartTime).TotalSeconds
          if ($status -eq 'playing' -and $timeline.LastUpdatedTime) {
            $drift = ([DateTimeOffset]::Now - $timeline.LastUpdatedTime).TotalSeconds
            if ($drift -gt 0 -and $drift -lt 30) { $position = $position + $drift }
          }
        }

        $sessions += [ordered]@{
          id       = [string]$session.SourceAppUserModelId
          app      = [string]$session.SourceAppUserModelId
          title    = if ($props) { [string]$props.Title } else { '' }
          artist   = if ($props) { [string]$props.Artist } else { '' }
          album    = if ($props) { [string]$props.AlbumTitle } else { '' }
          status   = $status
          position = [math]::Round([double]$position, 3)
          duration = [math]::Round([double]$duration, 3)
        }
      } catch {
        $sessions += [ordered]@{
          id       = [string]$session.SourceAppUserModelId
          app      = [string]$session.SourceAppUserModelId
          title    = ''
          artist   = ''
          album    = ''
          status   = 'unknown'
          position = 0.0
          duration = 0.0
          error    = $_.Exception.Message
        }
      }
    }

    Emit ([ordered]@{ type = 'sessions'; at = $at; sessions = $sessions })
  } catch {
    Emit ([ordered]@{ type = 'error'; at = $at; message = $_.Exception.Message })
    Start-Sleep -Milliseconds 1200
  }

  Start-Sleep -Milliseconds 600
}
`;
