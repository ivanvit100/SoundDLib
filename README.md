<div align="center">
  <img src="./screenshots/preview.png" alt="SoundDLib Banner" width="100%"/>
</div>

<div align="center">

# SoundDLib

**Браузерное расширение для загрузки музыки и плейлистов со стриминговых площадок**

[![Tests](https://github.com/ivanvit100/SoundDLib/actions/workflows/test.yaml/badge.svg)](https://github.com/ivanvit/SoundDLib/actions/workflows/test.yaml)
![Version](https://img.shields.io/badge/version-0.0.1-blue)
![Code Coverage](https://img.shields.io/badge/Coverage-96.95%25-brightgreen)

[📦 Скачать](#установка) · [⚠️ Сообщить об ошибке](https://github.com/ivanvit100/SoundDLib/issues) · [✏️ Участвовать в разработке](CONTRIBUTING.md)

</div>

<div align="center">

> Хотите помочь проекту или узнать, что планируется в следующих версиях? Смотрите [CONTRIBUTING.md](CONTRIBUTING.md).

</div>

---

## О проекте

**SoundDLib** — расширение для браузера, позволяющее скачивать музыку и плейлисты с сервисов [*Звук*](https://zvuk.com/) в форматах *MP3*, *FLAC*, *OGG*, *OPUS*, *WAV* и *AAC*.

---

## Скриншоты

<div align="center">
  <table>
    <tr>
      <td align="center">
        <img src="./screenshots/track_example.png" alt="Zvuk" width="300"/>
        <br/>
        <sub><b>Загрузка трека</b></sub>
      </td>
      <td align="center">
        <img src="./screenshots/playlist_example.png" alt="Zvuk" width="300"/>
        <br/>
        <sub><b>Загрузка плейлиста</b></sub>
      </td>
      <td align="center">
        <img src="./screenshots/history_example.png" alt="Zvuk" width="300"/>
        <br/>
        <sub><b>История загрузок</b></sub>
      </td>
    </tr>
  </table>
  <table>
    <tr>
      <td align="center">
        <img src="./screenshots/button_example.png" alt="Zvuk" width="300"/>
        <br/>
        <sub><b>Кнопка на сайте</b></sub>
      </td>
    </tr>
  </table>
</div>

---

## Возможности

<table>
  <tr>
    <td>🌐 <b>Множество сервисов</b></td>
    <td>Поддержка нескольких музыкальных стриминг-платформ — Zvuk, Яндекс Музыка, YouTube, Spotify, SoundCloud</td>
  </tr>
  <tr>
    <td>🎵 <b>Загрузка треков</b></td>
    <td>Скачивание отдельных треков в один клик прямо со страницы сервиса</td>
  </tr>
  <tr>
    <td>📋 <b>Загрузка плейлистов</b></td>
    <td>Скачивание целого плейлиста по файлам или одним ZIP-архивом</td>
  </tr>
  <tr>
    <td>🎛️ <b>Различные форматы</b></td>
    <td>Выбор формата и качества: MP3, AAC, FLAC, WAV, OGG, OPUS</td>
  </tr>
  <tr>
    <td>▶️ <b>Встроенный плеер</b></td>
    <td>Предварительное прослушивание трека прямо в попапе расширения</td>
  </tr>
  <tr>
    <td>🔘 <b>Кнопки в интерфейсе</b></td>
    <td>Кнопки скачивания встраиваются напрямую в интерфейс сайта</td>
  </tr>
  <tr>
    <td>🕓 <b>История загрузок</b></td>
    <td>Журнал всех скачанных треков с обложками, исполнителями и датами</td>
  </tr>
</table>

---

## Поддерживаемые браузеры

| Браузер | Поддержка |
|---|---|
| **Firefox** | В разработке |
| **Chromium** | В разработке |

---

## Установка

### Готовые сборки

1. Откройте раздел [**Releases**](https://github.com/ivanvit100/SoundDLib/releases).
2. Для **Firefox** скачайте `.xpi` файл последней версии.
3. Для **Chromium-браузеров** (Chrome, Edge, Яндекс и др.) скачайте `.crx` файл.

### Ручная установка

<details>
<summary><b>Firefox</b></summary>

1. Клонируйте репозиторий:
   ```sh
   git clone https://github.com/ivanvit100/SoundDLib
   ```
2. Откройте страницу `about:debugging` в Firefox.
3. Во вкладке **«Этот Firefox»** выберите **«Загрузить временное дополнение»**.
4. Убедитесь, что выбран файл [`manifest.firefox.json`](manifest.chrome.json) (переименуйте в `manifest.json`).

</details>

<details>
<summary><b>Chromium-браузеры</b></summary>

1. Клонируйте репозиторий:
   ```sh
   git clone https://github.com/ivanvit100/SoundDLib
   ```
2. Откройте страницу `chrome://extensions/` в браузере.
3. Включите **«Режим разработчика»**.
4. Нажмите **«Загрузить распакованное расширение»** и выберите папку проекта.
5. Убедитесь, что выбран файл [`manifest.chrome.json`](manifest.chrome.json) (переименуйте в `manifest.json`).

</details>

---

## Использование

1. Проект в разработке, инструкция появится позже

---

## Технические детали

- Больше информации в будущем.

---

## Другие проекты

- [`DownloadLib`](https://github.com/ivanvit100/DownloadLib) - загрузка тайтлов с проектов [MangaLib](https://mangalib.me/) и [RanobeLib](https://ranobelib.me/)

---

## Обратная связь

- [GitHub Issues](https://github.com/ivanvit100/SoundDLib/issues)
- Автор: [ivanvit.ru](https://ivanvit.ru)

---

<div align="center">
  <sub>SoundDLib — ваш удобный способ сохранить любимую музыку!</sub>
</div>
