import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type FileKind,
  type SelectedFile,
} from '@shared/ipc';
import { SetupScreen } from '@/components/setup/SetupScreen';
import { Experience } from '@/components/experience/Experience';
import { AudioService } from '@/services/audio/AudioService';
import { parseLrc } from '@/features/lyrics/lrcParser';
import { LyricTimeline } from '@/features/lyrics/timeline';
import { canEnterExperience, useAppStore } from '@/stores/appStore';
import { usePlaybackStore } from '@/stores/playbackStore';
import type { ExperienceSession } from './types';

export function App() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [service, setService] = useState<AudioService | null>(null);
  const [session, setSession] = useState<ExperienceSession | null>(null);
  const [version, setVersion] = useState('1.0');

  const phase = useAppStore((state) => state.phase);
  const audioFile = useAppStore((state) => state.audioFile);
  const lyricsFile = useAppStore((state) => state.lyricsFile);
  const lyrics = useAppStore((state) => state.lyrics);
  const settings = useAppStore((state) => state.settings);
  const audioError = useAppStore((state) => state.audioError);
  const lyricsError = useAppStore((state) => state.lyricsError);
  const experienceError = useAppStore((state) => state.experienceError);
  const notice = useAppStore((state) => state.notice);
  const isEntering = useAppStore((state) => state.isEntering);
  const settingsReady = useAppStore((state) => state.settingsReady);
  const canEnter = useAppStore(canEnterExperience);

  useEffect(() => {
    const element = audioRef.current;
    if (!element) return;
    const audioService = new AudioService(element);
    setService(audioService);
    const unsubscribe = audioService.subscribe((snapshot) => {
      usePlaybackStore.getState().applySnapshot(snapshot);
    });
    return () => {
      unsubscribe();
      audioService.destroy();
      setService(null);
    };
  }, []);

  useEffect(() => {
    void window.afterglow.app
      .getVersion()
      .then((value) => setVersion(value))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!settingsReady) return;
    const timer = window.setTimeout(() => {
      void window.afterglow.settings.save(settings).catch(() => undefined);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [settings, settingsReady]);

  useEffect(() => {
    if (!session) return;
    return () => {
      void window.afterglow.media.release(session.mediaToken).catch(() => undefined);
    };
  }, [session]);

  const remember = useCallback((file: SelectedFile) => {
    void window.afterglow.settings.remember(file).catch(() => undefined);
  }, []);

  const acceptAudio = useCallback(
    (file: SelectedFile) => {
      const store = useAppStore.getState();
      store.setAudioFile(file);
      store.setNotice(null);
      remember(file);
    },
    [remember],
  );

  const acceptLyrics = useCallback(
    async (file: SelectedFile) => {
      const store = useAppStore.getState();
      try {
        const read = await window.afterglow.files.readLyrics(file.path);
        if (!read.ok) {
          store.setLyricsFile(file, null);
          store.setLyricsError(read.error.message);
          return;
        }
        const parsed = parseLrc(read.text);
        if (!parsed.ok) {
          store.setLyricsFile(read.file, null);
          store.setLyricsError(parsed.error.message);
          return;
        }
        store.setLyricsFile(read.file, parsed.lyrics);
        store.setNotice(null);
        remember(read.file);
      } catch {
        store.setLyricsFile(file, null);
        store.setLyricsError('The lyrics file could not be read.');
      }
    },
    [remember],
  );

  const pickAudio = useCallback(async () => {
    const store = useAppStore.getState();
    store.setExperienceError(null);
    try {
      const result = await window.afterglow.files.pick('audio');
      if ('canceled' in result) return;
      if (!result.ok) {
        store.setAudioError(result.error.message);
        return;
      }
      acceptAudio(result.file);
    } catch {
      store.setAudioError('The file picker could not be opened. Try dragging the file in.');
    }
  }, [acceptAudio]);

  const pickLyrics = useCallback(async () => {
    const store = useAppStore.getState();
    store.setExperienceError(null);
    try {
      const result = await window.afterglow.files.pick('lyrics');
      if ('canceled' in result) return;
      if (!result.ok) {
        store.setLyricsError(result.error.message);
        return;
      }
      await acceptLyrics(result.file);
    } catch {
      store.setLyricsError('The file picker could not be opened. Try dragging the file in.');
    }
  }, [acceptLyrics]);

  const acceptDropped = useCallback(
    async (kind: FileKind, file: File) => {
      const store = useAppStore.getState();
      store.setExperienceError(null);
      try {
        const path = window.afterglow.files.pathForFile(file);
        if (!path) {
          const message = 'The path of that dropped file could not be read. Use the file picker.';
          if (kind === 'audio') store.setAudioError(message);
          else store.setLyricsError(message);
          return;
        }
        const validated = await window.afterglow.files.validate(kind, path);
        if (!validated.ok) {
          if (kind === 'audio') store.setAudioError(validated.error.message);
          else store.setLyricsError(validated.error.message);
          return;
        }
        if (kind === 'audio') acceptAudio(validated.file);
        else await acceptLyrics(validated.file);
      } catch {
        const message = 'That file could not be validated.';
        if (kind === 'audio') store.setAudioError(message);
        else store.setLyricsError(message);
      }
    },
    [acceptAudio, acceptLyrics],
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const snapshot = await window.afterglow.settings.load();
        if (cancelled) return;
        const store = useAppStore.getState();
        store.applySettingsSnapshot(snapshot);
        let missing = false;

        if (snapshot.recent.audio && !store.audioFile) {
          const validated = await window.afterglow.files.validate(
            'audio',
            snapshot.recent.audio.path,
          );
          if (cancelled) return;
          if (validated.ok) {
            if (!useAppStore.getState().audioFile) {
              useAppStore.getState().setAudioFile(validated.file);
            }
          } else {
            missing = true;
            await window.afterglow.settings.forget('audio').catch(() => undefined);
          }
        }

        if (snapshot.recent.lyrics && !store.lyricsFile) {
          const read = await window.afterglow.files.readLyrics(snapshot.recent.lyrics.path);
          if (cancelled) return;
          if (read.ok) {
            const parsed = parseLrc(read.text);
            if (parsed.ok) {
              if (!useAppStore.getState().lyricsFile) {
                useAppStore.getState().setLyricsFile(read.file, parsed.lyrics);
              }
            } else {
              missing = true;
              await window.afterglow.settings.forget('lyrics').catch(() => undefined);
            }
          } else {
            missing = true;
            await window.afterglow.settings.forget('lyrics').catch(() => undefined);
          }
        }

        if (missing && !cancelled) {
          useAppStore
            .getState()
            .setNotice('A file from your last session is no longer available. Select it again.');
        }
      } catch {
        if (cancelled) return;
        useAppStore.getState().applySettingsSnapshot({
          settings: { ...DEFAULT_SETTINGS },
          recent: { audio: null, lyrics: null },
        });
        useAppStore
          .getState()
          .setNotice('Settings could not be restored. AFTERGLOW will still work normally.');
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSettingsChange = useCallback((patch: Partial<AppSettings>) => {
    useAppStore.getState().updateSettings(patch);
  }, []);

  const handleExited = useCallback(() => {
    setSession(null);
    usePlaybackStore.getState().reset();
    useAppStore.getState().exitExperience();
    service?.unload();
  }, [service]);

  const handleFatalError = useCallback(
    async (message: string) => {
      try {
        await window.afterglow.experience.exit();
      } catch {
        // The doorway is still the safest state if the fullscreen call fails.
      }
      setSession(null);
      usePlaybackStore.getState().reset();
      service?.unload();
      useAppStore.getState().failEntrance(message);
    },
    [service],
  );

  const handleEnter = useCallback(async () => {
    const store = useAppStore.getState();
    if (!service || !store.audioFile || !store.lyricsFile || !canEnterExperience(store)) {
      return;
    }

    store.beginEntering();
    let token: string | null = null;

    try {
      const audioCheck = await window.afterglow.files.validate('audio', store.audioFile.path);
      if (!audioCheck.ok) {
        store.setAudioError(audioCheck.error.message);
        store.failEntrance('The audio file needs attention before entering.');
        return;
      }

      const lyricsRead = await window.afterglow.files.readLyrics(store.lyricsFile.path);
      if (!lyricsRead.ok) {
        store.setLyricsError(lyricsRead.error.message);
        store.failEntrance('The lyrics file needs attention before entering.');
        return;
      }

      const parsed = parseLrc(lyricsRead.text);
      if (!parsed.ok) {
        store.setLyricsError(parsed.error.message);
        store.failEntrance('The lyrics file could not be read.');
        return;
      }
      if (parsed.lyrics.lines.length === 0) {
        store.setLyricsError('The lyrics file has no timestamped lines.');
        store.failEntrance('The lyrics file could not be read.');
        return;
      }
      store.setLyricsFile(lyricsRead.file, parsed.lyrics);

      const prepared = await window.afterglow.media.prepare(audioCheck.file.path);
      if (!prepared.ok) {
        store.setAudioError(prepared.error.message);
        store.failEntrance('The audio file could not be prepared for playback.');
        return;
      }
      token = prepared.source.token;
      const duration = await service.load(prepared.source.url);

      try {
        await Promise.all([
          document.fonts.load('600 32px "Inter"'),
          document.fonts.load('700 32px "Inter"'),
          document.fonts.load('800 32px "Inter"'),
          document.fonts.ready,
        ]);
      } catch {
        // Segoe UI Variable / Segoe UI remains an acceptable fallback.
      }

      const reducedMotion =
        store.settings.reducedMotion === 'on' ||
        (store.settings.reducedMotion === 'auto' &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches);

      const timeline = new LyricTimeline(parsed.lyrics, {
        durationMs: duration * 1000,
        offsetMs: store.settings.offsetMs,
        wordReveal: store.settings.wordReveal,
      });

      const fullscreen = await window.afterglow.experience.enter();
      if (!fullscreen.ok) {
        throw new Error(fullscreen.error ?? 'Windows did not enter fullscreen.');
      }

      setSession({
        timeline,
        mediaToken: token,
        style: store.settings.constellationStyle,
        intensity: store.settings.intensity,
        reducedMotion,
        temporaryControls: store.settings.temporaryControls,
      });
      useAppStore.getState().enterExperience();
    } catch (error) {
      if (token) void window.afterglow.media.release(token).catch(() => undefined);
      service.unload();
      void window.afterglow.experience.exit().catch(() => undefined);
      useAppStore
        .getState()
        .failEntrance(
          error instanceof Error
            ? error.message
            : 'The experience could not start. Check both files and try again.',
        );
    }
  }, [service]);

  return (
    <div className="h-full">
      <audio
        ref={audioRef}
        preload="auto"
        className="hidden"
        data-testid="afterglow-audio"
        aria-hidden="true"
      />
      {phase === 'experience' && session ? (
        <Experience
          session={session}
          service={service}
          onExited={handleExited}
          onFatalError={(message) => {
            void handleFatalError(message);
          }}
        />
      ) : (
        <SetupScreen
          audioFile={audioFile}
          lyricsFile={lyricsFile}
          lyrics={lyrics}
          settings={settings}
          audioError={audioError}
          lyricsError={lyricsError}
          experienceError={experienceError}
          notice={notice}
          isEntering={isEntering}
          canEnter={canEnter}
          version={version}
          onPickAudio={() => void pickAudio()}
          onPickLyrics={() => void pickLyrics()}
          onDropAudio={(file) => void acceptDropped('audio', file)}
          onDropLyrics={(file) => void acceptDropped('lyrics', file)}
          onSettingsChange={handleSettingsChange}
          onEnter={() => void handleEnter()}
        />
      )}
    </div>
  );
}
