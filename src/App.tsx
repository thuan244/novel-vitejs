import { useState, useEffect } from 'react';
import * as cheerio from 'cheerio';
import { GoogleGenAI } from '@google/genai';
import audioBufferToWav from 'audiobuffer-to-wav';
import { Buffer } from 'buffer';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || 'AIzaSyCl9ilmG07DzcYybGIVjNaiDMBs_LbxUck';
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const API_BASE_URL = 'http://localhost/novel-vitejs';

// Hàm chuyển ArrayBuffer thành base64
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const binary = bytes.reduce((acc, byte) => acc + String.fromCharCode(byte), '');
  return btoa(binary);
}

// Hàm retry với tối đa 3 lần
async function retry<T>(fn: () => Promise<T>, retries = 3, delay = 1000): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === retries - 1) throw error;
      console.warn(`Thử lại lần ${i + 1} sau lỗi:`, error);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('Không thể thực hiện sau khi thử lại');
}

// Giao diện để mở rộng window với webkitAudioContext
interface ExtendedWindow extends Window {
  webkitAudioContext?: typeof AudioContext;
  AudioContext?: typeof AudioContext;
}

async function saveWaveFile(audioData: Buffer, filename: string, channels = 1, rate = 24000) {
  const extendedWindow = window as ExtendedWindow;
  const AudioContextConstructor = extendedWindow.AudioContext || extendedWindow.webkitAudioContext;
  if (!AudioContextConstructor) {
    throw new Error('AudioContext không được hỗ trợ trên trình duyệt này');
  }
  const audioContext = new AudioContextConstructor();
  const numberOfChannels = channels;
  const sampleRate = rate;
  const length = audioData.length / 2;
  const audioBuffer = audioContext.createBuffer(numberOfChannels, length, sampleRate);

  const channelData = audioBuffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    channelData[i] = audioData.readInt16LE(i * 2) / 32768;
  }

  const wavBuffer = audioBufferToWav(audioBuffer);
  const wavBase64 = arrayBufferToBase64(wavBuffer);
  return { wavBuffer: wavBase64, filename };
}

async function call_tts(content: string) {
  const response = await retry(() => ai.models.generateContent({
    model: 'gemini-2.5-flash-preview-tts',
    contents: [{ parts: [{ text: content }] }],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' },
        },
      },
    },
  }));

  const data = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!data) {
    throw new Error('Không nhận được dữ liệu âm thanh từ API');
  }
  const audioBuffer = Buffer.from(data, 'base64');
  const audioFilename = `audio_${Date.now()}.wav`;
  const { wavBuffer } = await saveWaveFile(audioBuffer, audioFilename);
  return { audioData: wavBuffer, audioFilename };
}

export default function TruyenWikiDich() {
  const [url, setUrl] = useState('');
  const [output, setOutput] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [finished, setFinished] = useState(false);
  const [chapters, setChapters] = useState<{ slug: string; name: string }[]>([]);
  const [isChaptersOpen, setIsChaptersOpen] = useState(false);
  const [currentChapterSlug, setCurrentChapterSlug] = useState('');

  const getChapterSlugFromUrl = (url: string) => {
    const parts = url.split('/');
    return parts[parts.length - 1].replace(/[^a-zA-Z0-9]/g, '_');
  };

  const fetchChapters = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/list_files.php`, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
      });
      const data = await res.json();
      if (data.success) {
        setChapters(data.chapters);
      } else {
        console.error('Lỗi khi lấy danh sách chapter:', data.error);
      }
    } catch (error) {
      console.error('Lỗi khi lấy danh sách chapter:', error);
    }
  };

  const checkChapterInStorage = async (chapterSlug: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/check_file.php?chapter_name=${chapterSlug}`, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
      });
      const data = await res.json();
      console.log('Check chapter response:', data);
      if (data.exists && !Array.isArray(data.data)) {
        console.error('Dữ liệu chapter không phải mảng:', data.data);
        return { exists: false, data: [] };
      }
      return data;
    } catch (error) {
      console.error('Lỗi khi kiểm tra chapter:', error);
      return { exists: false, data: [] };
    }
  };

  const saveChapterToServer = async (chapterSlug: string, jsonData: any[], audioData: string, audioFilename: string) => {
    try {
      console.log('Gửi yêu cầu lưu chapter:', { chapterSlug, jsonData, audioFilename });
      const response = await fetch(`${API_BASE_URL}/save_files.php`, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chapter_name: chapterSlug,
          json_data: jsonData,
          audio_data: audioData,
          audio_filename: audioFilename,
        }),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      const result = await response.json();
      console.log('Save chapter response:', result);
      if (!result.success) {
        throw new Error(result.error || 'Lỗi khi lưu file lên server');
      }
      return result;
    } catch (error) {
      console.error('Lỗi khi lưu chapter:', error);
      throw error;
    }
  };

  const deleteAllData = async () => {
    if (!confirm('Bạn có chắc muốn xóa toàn bộ dữ liệu trong /posts và /audio?')) return;
    try {
      const response = await fetch(`${API_BASE_URL}/delete_files.php`, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      const result = await response.json();
      if (result.success) {
        alert('Xóa toàn bộ dữ liệu thành công!');
        setChapters([]);
        setOutput([]);
        setCurrentChapterSlug('');
      } else {
        alert('Lỗi khi xóa dữ liệu: ' + result.error);
      }
    } catch (error) {
      console.error('Lỗi khi xóa dữ liệu:', error);
      alert('Lỗi khi xóa dữ liệu: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  };

  const loadChapterFromStorage = async (chapterSlug: string) => {
    setLoading(true);
    setFinished(false);
    setOutput([]);
    setCurrentChapterSlug(chapterSlug);

    const cachedChapter = await checkChapterInStorage(chapterSlug);
    if (cachedChapter.exists) {
      if (Array.isArray(cachedChapter.data)) {
        setOutput(cachedChapter.data.map((item: any) => [
          `<div class='translated-vi animate-fade-in border-b-1 pb-4 text-[18px] leading-7'>${item.viText}</div>`,
          `<div class='translated-en animate-fade-in border-b-1 pb-4 text-[18px] leading-7'>
            <button class="play-audio-btn px-2 py-1 bg-green-600 text-white rounded-md hover:bg-green-700 transition mr-2" data-audio="${API_BASE_URL}/audio/${item.audioFilename}">Nghe</button>
            ${item.enText}
          </div>`
        ]).flat());
      } else {
        console.error('Dữ liệu chapter không phải mảng:', cachedChapter.data);
        setOutput([`<div class='text-red-600'>Lỗi: Dữ liệu chapter không hợp lệ. Vui lòng xóa dữ liệu và thử lại.</div>`]);
      }
    } else {
      setOutput([`<div class='text-red-600'>Lỗi: Không tìm thấy dữ liệu chapter.</div>`]);
    }
    setLoading(false);
    setFinished(true);
  };

  const fetchContent = async (inputUrl = url) => {
    setLoading(true);
    setFinished(false);
    setOutput([]);
    const chapterSlug = getChapterSlugFromUrl(inputUrl);
    setCurrentChapterSlug(chapterSlug);

    const cachedChapter = await checkChapterInStorage(chapterSlug);
    if (cachedChapter.exists) {
      if (Array.isArray(cachedChapter.data)) {
        setOutput(cachedChapter.data.map((item: any) => [
          `<div class='translated-vi animate-fade-in border-b-1 pb-4 text-[18px] leading-7'>${item.viText}</div>`,
          `<div class='translated-en animate-fade-in border-b-1 pb-4 text-[18px] leading-7'>
            <button class="play-audio-btn px-2 py-1 bg-green-600 text-white rounded-md hover:bg-green-700 transition mr-2" data-audio="${API_BASE_URL}/audio/${item.audioFilename}">Nghe</button>
            ${item.enText}
          </div>`
        ]).flat());
        setLoading(false);
        setFinished(true);
        await fetchChapters();
        return;
      } else {
        console.error('Dữ liệu chapter không phải mảng:', cachedChapter.data);
        setOutput([`<div class='text-red-600'>Lỗi: Dữ liệu chapter không hợp lệ. Vui lòng xóa dữ liệu và thử lại.</div>`]);
      }
    }

    try {
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Accept-Language': 'vi,vi-VN;q=0.9,en-GB;q=0.8,en;q=0.7,fr-FR;q=0.6,fr;q=0.5,en-US;q=0.4',
        'Connection': 'keep-alive',
        'Origin': 'https://truyenwikidich.net',
        'Referer': 'https://truyenwikidich.net',
        'sec-ch-ua': '"Google Chrome";v="137", "Chromium";v="137", "Not/A)Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'x-requested-with': 'XMLHttpRequest',
      };

      const res = await fetch(inputUrl, { headers });
      if (!res.ok) {
        throw new Error(`Failed to fetch: ${res.status} ${res.statusText}`);
      }

      const html = await res.text();
      const $ = cheerio.load(html);
      const chapterName = $('.top-title > .chapter-name').text().trim() || chapterSlug;
      const paragraphs = $('#bookContentBody p').toArray();

      const chunks: string[] = [];
      let buffer = '';

      for (const p of paragraphs) {
        const html = $.html(p);
        if ((buffer + html).length >= 2500) {
          chunks.push(buffer);
          buffer = html;
        } else {
          buffer += html;
        }
      }
      if (buffer) chunks.push(buffer);

      const translatedData: any[] = [];
      const audioFiles: { audioData: string; audioFilename: string; audioPath: string }[] = [];

      for (const chunk of chunks) {
        setOutput((prev) => [...prev, `<div class='loading-animation'>Đang dịch...</div>`]);

        const viPrompt = `Đoạn trích dưới đây được dịch từ công cụ dịch tự động lỗi thời còn bạn là chuyên gia viết tiểu thuyết, hãy viết lại đoạn sau bằng tiếng Việt, giữ nguyên bối cảnh và nội dung, giữ nguyên định dạng markup:\n\n${chunk}`;
        const viRes = await retry(() => fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: viPrompt }] }] }),
          }
        ));
        const viData = await viRes.json();
        const viText = viData?.candidates?.[0]?.content?.parts?.[0]?.text || chunk;

        setOutput((prev) => [
          ...prev.slice(0, -1),
          `<div class='translated-vi animate-fade-in border-b-1 pb-4 text-[18px] leading-7'>${viText}</div>`,
        ]);

        setOutput((prev) => [...prev, `<div class='loading-animation'>Đang dịch tiếng Anh...</div>`]);

        const enPrompt = `Đoạn trích dưới đây được dịch từ công cụ dịch tự động lỗi thời còn bạn là chuyên gia dịch thuật từ tiếng Việt sang tiếng Anh và là chuyên gia viết tiểu thuyết, hãy dịch lại đoạn sau sang tiểu thuyết bằng tiếng Anh trình độ A2, giữ nguyên bối cảnh và nội dung, giữ nguyên định dạng markup:\n\n${viText}`;
        const enRes = await retry(() => fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: enPrompt }] }] }),
          }
        ));
        const enData = await enRes.json();
        const enText = enData?.candidates?.[0]?.content?.parts?.[0]?.text || chunk;
        const { audioData, audioFilename } = await call_tts(enText);

        const { audio_path } = await saveChapterToServer(chapterSlug, [{ chapterName, viText, enText, audioFilename }], audioData, audioFilename);

        setOutput((prev) => [
          ...prev.slice(0, -1),
          `<div class='translated-en animate-fade-in border-b-1 pb-4 text-[18px] leading-7'>
            <button class="play-audio-btn px-2 py-1 bg-green-600 text-white rounded-md hover:bg-green-700 transition mr-2" data-audio="${audio_path || `${API_BASE_URL}/audio/${audioFilename}`}">Nghe</button>
            ${enText}
          </div>`,
        ]);

        translatedData.push({ chapterName, viText, enText, audioFilename });
        audioFiles.push({ audioData, audioFilename, audioPath: audio_path || `${API_BASE_URL}/audio/${audioFilename}` });
      }

      // Lưu toàn bộ translatedData với chapterName
      await saveChapterToServer(chapterSlug, translatedData, '', '');
      await fetchChapters();
    } catch (error) {
      console.error('Error fetching content:', error);
      setOutput((prev) => [...prev, `<div class='text-red-600'>Lỗi khi tải nội dung: ${error instanceof Error ? error.message : 'Unknown error'}</div>`]);
    } finally {
      setLoading(false);
      setFinished(true);
    }
  };

  useEffect(() => {
    fetchChapters();
    // Thêm sự kiện click cho các nút play audio
    const handlePlayAudio = (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('play-audio-btn')) {
        const audioSrc = target.getAttribute('data-audio');
        if (audioSrc) {
          const audio = new Audio(audioSrc);
          audio.play().catch(err => console.error('Lỗi khi phát audio:', err));
        }
      }
    };
    document.addEventListener('click', handlePlayAudio);
    return () => document.removeEventListener('click', handlePlayAudio);
  }, []);

  return (
    <main className="bg-gray-950 text-white min-h-[100vh]">
      <div className="container p-4 max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="font-bold mb-6 text-2xl">Truyện từ Truyenwikidich</h1>
          <input
            type="text"
            placeholder="Nhập URL chương truyện"
            className="border p-2 w-full rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600 text-black"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            name="chapUrl"
            id="chapUrl"
          />
          <div className="mt-4 flex space-x-4">
            <button
              onClick={() => fetchContent(url)}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-md disabled:bg-gray-400 hover:bg-blue-700 transition"
            >
              Dịch chương
            </button>
            <button
              onClick={deleteAllData}
              className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition"
            >
              Xóa toàn bộ dữ liệu
            </button>
            {currentChapterSlug && (
              <button
                onClick={() => fetchContent(`https://truyenwikidich.net/truyen/dummy/${currentChapterSlug}`)}
                disabled={loading}
                className="px-4 py-2 bg-yellow-600 text-white rounded-md disabled:bg-gray-400 hover:bg-yellow-700 transition"
              >
                Làm mới chương
              </button>
            )}
          </div>
        </div>

        {loading && (
          <p className="mt-4 text-yellow-600 animate-pulse">Đang tải nội dung...</p>
        )}

        <div className="mt-6">
          <button
            onClick={() => setIsChaptersOpen(!isChaptersOpen)}
            className="w-full px-4 py-2 bg-gray-700 text-white rounded-md hover:bg-gray-800 transition flex justify-between items-center"
          >
            <span>Danh sách chương ({chapters.length})</span>
            <span>{isChaptersOpen ? '▲' : '▼'}</span>
          </button>
          {isChaptersOpen && (
            <div className="mt-2 bg-gray-800 rounded-md p-4">
              {chapters.length > 0 ? (
                <ul className="space-y-2">
                  {chapters.map((chapter) => (
                    <li
                      key={chapter.slug}
                      className="text-blue-400 hover:underline cursor-pointer"
                      onClick={() => loadChapterFromStorage(chapter.slug)}
                    >
                      {chapter.name}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Chưa có chương nào được lưu.</p>
              )}
            </div>
          )}
        </div>

        <div className="mt-6 space-y-4" dangerouslySetInnerHTML={{ __html: output.join('') }} />

        {finished && (
          <div className="mt-6">
            <p className="text-green-700">✅ Đã hết nội dung chương.</p>
          </div>
        )}
      </div>
    </main>
  );
}