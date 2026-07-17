/**
 * SoundDLib core module
 * Manages single-track download: fetch from AudioStore → convert → save
 * @module core/SingleTrackManager
 * @author ivanvit
 * @version 0.0.1
 */

'use strict';

(function(global) {
    class SingleTrackManager {
        constructor() {
            this.eventBus = new global.EventBus();
        }

        async download(trackId, format, qualityUrl, converter) {
            this.eventBus.emit('download:started', { trackId });

            try {
                const api = typeof global.getExtensionApi === 'function'
                    ? global.getExtensionApi()
                    : (global.chrome || global.browser);

                this.eventBus.emit('download:progress', { message: 'Получение трека...', percent: 5 });

                const resp = await api.runtime.sendMessage({
                    action: trackId ? 'getTrack' : 'getLatestTrack',
                    trackId
                });

                if (!resp?.ok)
                    throw new Error(resp?.error || 'Трек не найден в хранилище');

                const meta = { ...(resp.meta || {}) };
                let inputBuffer;
                let inputMimeType = resp.mimeType;

                // Enrich meta (cover, accurate title/artist) if not already present
                if (!meta.cover) {
                    const hlsUrl = resp.masterUrl || resp.url;
                    const zvukId = hlsUrl?.match(/\/track\/(\d+)\//)?.[1];
                    if (zvukId) {
                        const svcName = resp.serviceName || 'zvuk';
                        const svc = global.serviceRegistry?.getService(svcName);
                        if (svc) {
                            try {
                                const fresh = await svc.fetchTrackMeta(zvukId);
                                Object.assign(meta, fresh);
                            } catch {}
                        }
                    }
                }

                let conversionStartPct = 15;

                if (resp.type && resp.type !== 'audio') {
                    const serviceName = resp.serviceName || 'zvuk';
                    const service = global.serviceRegistry?.getService(serviceName);
                    if (!service)
                        throw new Error(`Сервис "${serviceName}" не найден в реестре`);

                    const result = await service.getAudioData(
                        resp,
                        { qualityUrl },
                        api,
                        (phase, done, total) => {
                            if (phase === 'key') {
                                this.eventBus.emit('download:progress',
                                    { message: 'Получение ключа...', percent: 8 });
                            } else if (phase === 'init') {
                                this.eventBus.emit('download:progress',
                                { message: 'Инициализация потока...', percent: 10 });
                            } else if (phase === 'segment') {
                                const pct = 10 + Math.round(((done + 1) / total) * 65);
                                this.eventBus.emit('download:progress', {
                                    message: `Сегменты: ${done + 1}/${total}`, percent: pct
                                });
                            }
                        }
                    );
                    inputBuffer = result.data;
                    inputMimeType = result.mimeType;
                    conversionStartPct = 75;
                } else if (resp.data)
                    inputBuffer = new Uint8Array(resp.data).buffer;
                else if (resp.url) {
                    this.eventBus.emit('download:progress', { message: 'Загрузка аудиофайла...', percent: 10 });
                    const fetchResp = await api.runtime.sendMessage({ action: 'fetchAudioTrack', url: resp.url });
                    if (!fetchResp?.ok)
                        throw new Error(fetchResp?.error || 'Не удалось загрузить аудиофайл');

                    const fetchedMime = fetchResp.mimeType || '';
                    console.log(`[SingleTrackManager] fetchAudioTrack: ${fetchResp.data?.length} bytes, mime=${fetchedMime}`);
                    if (fetchedMime && !fetchedMime.startsWith('audio/')) {
                        throw new Error(
                            `CDN вернул ${fetchedMime} вместо аудио. ` +
                            `Токен мог устареть — перезапустите воспроизведение.`
                        );
                    }

                    inputBuffer = new Uint8Array(fetchResp.data).buffer;
                    inputMimeType = fetchedMime || resp.mimeType;
                } else throw new Error('Нет данных для скачивания');

                this.eventBus.emit('download:progress', { message: 'Конвертация...', percent: conversionStartPct });

                const outputBuffer = await converter.convert(
                    inputBuffer,
                    inputMimeType,
                    format,
                    (pct) => this.eventBus.emit('download:progress', {
                        message: 'Конвертация...',
                        percent: conversionStartPct + Math.round(pct * (95 - conversionStartPct) / 100)
                    })
                );

                const formatMeta = global.ConverterRegistry.getMeta(format);
                const filename = this._buildFilename(meta, formatMeta.ext);
                const blob = new Blob([outputBuffer], { type: formatMeta.mimeType });

                this._saveFile(blob, filename);

                global.DownloadHistory.add({
                    service: 'zvuk',
                    title: meta.title || 'Unknown',
                    artist: meta.artist || '',
                    cover: meta.cover || null,
                    format,
                    trackId: resp.trackId
                });

                this.eventBus.emit('download:completed', { filename, meta, format });
                return { success: true, filename };
            } catch (error) {
                this.eventBus.emit('download:failed', { error });
                throw error;
            }
        }

        _buildFilename(meta, ext) {
            const parts = [meta.artist, meta.title].filter(Boolean);
            const base = parts.length ? parts.join(' - ') : 'track';
            return `${base}.${ext}`.replace(/[/\\?%*:|"<>]/g, '_');
        }

        _saveFile(blob, filename) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 10000);
        }
    }

    global.SingleTrackManager = SingleTrackManager;
    console.log('[SingleTrackManager] Loaded');
})(typeof window !== 'undefined' ? window : self);
