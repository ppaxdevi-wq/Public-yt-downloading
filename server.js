const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 4200;
const COOKIES_FILE = path.join(__dirname, 'cookies.txt');

// Check if URL is from YouTube
function isYouTube(url) {
    return /(youtube\.com|youtu\.be)/i.test(url);
}

// Build yt-dlp arguments for streaming
function buildYtDlpArgs(videoUrl, quality, audioOnly, audioQuality) {
    const args = [
        '--no-playlist',
        '--no-warnings',
        '--no-check-certificate',
        '--no-cache-dir',
        '--remote-components', 'ejs:github',
        '--js-runtimes', 'node',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        '--output', '-',
    ];

    if (fs.existsSync(COOKIES_FILE)) {
        args.push('--cookies', COOKIES_FILE);
    }

    // YouTube-specific options (only if URL is YouTube)
    if (isYouTube(videoUrl)) {
        args.push('--extractor-args', 'youtube:player_client=android,web_embedded,default');
    }

    if (audioOnly) {
        args.push('-f', 'bestaudio/best', '-x', '--audio-format', 'mp3');
        if (audioQuality && audioQuality !== 'best') {
            args.push('--audio-quality', audioQuality);
        }
    } else {
        if (quality === 'best' || parseInt(quality) > 720) {
            // High quality: merge (uses ffmpeg, writes temp file then streams)
            args.push('-f', 'bestvideo+bestaudio/best');
            args.push('--merge-output-format', 'mp4');
        } else {
            // Low/medium quality: single file (no merge, less RAM)
            const height = quality === 'best' ? 'best' : `best[height<=${quality}]`;
            args.push('-f', `${height}[ext=mp4]/best[ext=mp4]/best`);
        }
    }

    args.push(videoUrl);
    return args;
}

// Streaming endpoint (returns media stream)
app.get(['/api/download', '/api/download-video'], (req, res) => {
    const videoUrl = req.query.url;
    const quality = req.query.quality || 'best';
    const audioOnly = req.query.audio === 'true';
    const audioQuality = req.query.audio_quality || 'best';

    if (!videoUrl) return res.status(400).send('URL required');

    console.log(`Streaming: quality=${quality}, audio=${audioOnly}, audioQuality=${audioQuality}`);

    const args = buildYtDlpArgs(videoUrl, quality, audioOnly, audioQuality);
    const ytDlp = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const ext = audioOnly ? 'mp3' : 'mp4';
    res.setHeader('Content-Type', audioOnly ? 'audio/mpeg' : 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="download.${ext}"`);
    res.setHeader('Cache-Control', 'no-cache');
    req.setTimeout(0);
    res.setTimeout(0);

    ytDlp.stdout.pipe(res);

    ytDlp.stderr.on('data', (data) => {
        console.error(`[yt-dlp] ${data.toString().trim()}`);
    });

    ytDlp.on('error', (err) => {
        console.error('yt-dlp failed to start:', err);
        if (!res.headersSent) res.status(500).send('Download failed');
        else res.end();
    });

    ytDlp.on('close', (code) => {
        console.log(`yt-dlp exited with code ${code}`);
        if (code !== 0 && !res.headersSent) {
            res.status(500).send('Download failed');
        }
        res.end();
    });

    req.on('close', () => {
        if (!res.writableEnded) {
            ytDlp.kill('SIGTERM');
        }
    });
});

// Resolve endpoint (returns a download URL for use in external download managers)
app.get('/api/resolve', (req, res) => {
    const videoUrl = req.query.url;
    const quality = req.query.quality || 'best';
    const audioOnly = req.query.audio === 'true';
    const audioQuality = req.query.audio_quality || 'best';

    if (!videoUrl) return res.status(400).json({ error: 'URL required' });

    const query = new URLSearchParams({
        url: videoUrl,
        quality,
        audio: audioOnly ? 'true' : 'false',
        audio_quality: audioQuality,
    });
    const downloadLink = `${req.protocol}://${req.get('host')}/api/download?${query.toString()}`;
    res.json({ downloadLink });
});

// =========================================================
// NEW ENDPOINT: Get Direct Link (No server streaming - Safe for Render)
// =========================================================
app.get('/api/get-direct-link', (req, res) => {
    const videoUrl = req.query.url;

    if (!videoUrl) return res.status(400).json({ error: 'URL required' });

    // 🌟 MAGIC FIX: Force yt-dlp to find HTTP/HTTPS .mp4 link instead of .m3u8 stream
    const args = [
        '-f', 'best[ext=mp4][protocol^=https]/best[ext=mp4][protocol^=http]/best[ext=mp4]/best', 
        '-g', 
        '--no-warnings'
    ];

    if (fs.existsSync(COOKIES_FILE)) {
        args.push('--cookies', COOKIES_FILE);
    }
    
    args.push(videoUrl);

    const ytDlp = spawn('yt-dlp', args);
    let directUrls = '';

    ytDlp.stdout.on('data', (data) => {
        directUrls += data.toString();
    });

    ytDlp.on('close', (code) => {
        if (code === 0 && directUrls.trim()) {
            const url = directUrls.split('\n')[0].trim();
            res.json({ success: true, downloadLink: url });
        } else {
            res.status(500).json({ error: 'Failed to extract direct link' });
        }
    });
});
// =========================================================

app.use(express.static(__dirname));
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
