const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 4200;
const COOKIES_FILE = path.join(__dirname, 'cookies.txt');

// Function to get direct URL (redirect mode)
function getDirectUrl(videoUrl, quality, audioOnly, audioQuality) {
    return new Promise((resolve, reject) => {
        const args = ['--no-playlist', '--no-warnings', '--remote-components', 'ejs:github', '--js-runtimes', 'node', '-g'];
        
        // User-Agent and extractor args to avoid bot detection
        args.push('--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        args.push('--extractor-args', 'youtube:player_client=android,web_embedded,default');
        
        if (fs.existsSync(COOKIES_FILE)) args.push('--cookies', COOKIES_FILE);
        
        if (audioOnly) {
            args.push('-f', 'bestaudio/best');
            if (audioQuality && audioQuality !== 'best') {
                args.push('--audio-quality', audioQuality);
            }
        } else {
            if (quality === 'best' || parseInt(quality) > 720) {
                // High quality: merge video+audio (requires ffmpeg and temporary disk)
                args.push('-f', 'bestvideo[height<=' + (quality === 'best' ? '99999' : quality) + ']+bestaudio/best[height<=' + (quality === 'best' ? '99999' : quality) + ']/best');
                args.push('--merge-output-format', 'mp4');
            } else {
                // Lower quality: single file (no merge, low RAM)
                const height = quality === 'best' ? 'best' : `best[height<=${quality}]`;
                args.push('-f', `${height}[ext=mp4]/best[ext=mp4]/best`);
            }
        }
        
        args.push(videoUrl);
        
        const ytDlp = spawn('yt-dlp', args);
        let output = '';
        let err = '';
        ytDlp.stdout.on('data', d => output += d);
        ytDlp.stderr.on('data', d => err += d);
        ytDlp.on('close', code => {
            if (code === 0 && output.trim()) resolve(output.trim().split('\n')[0]);
            else reject(new Error(err || 'Failed to get URL'));
        });
        ytDlp.on('error', reject);
    });
}

app.get(['/api/download', '/api/download-video'], async (req, res) => {
    const videoUrl = req.query.url;
    const quality = req.query.quality || 'best';
    const audioOnly = req.query.audio === 'true';
    const audioQuality = req.query.audio_quality || 'best';

    if (!videoUrl) return res.status(400).send('URL required');

    try {
        const directUrl = await getDirectUrl(videoUrl, quality, audioOnly, audioQuality);
        console.log('Redirecting to:', directUrl.substring(0, 100) + '...');
        res.redirect(302, directUrl);
    } catch (err) {
        console.error('Redirect failed, falling back to streaming:', err.message);
        // Fallback streaming
        const args = ['--no-playlist', '--no-warnings', '--remote-components', 'ejs:github', '--js-runtimes', 'node', '-o', '-'];
        args.push('--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        args.push('--extractor-args', 'youtube:player_client=android,web_embedded,default');
        
        if (fs.existsSync(COOKIES_FILE)) args.push('--cookies', COOKIES_FILE);
        
        if (audioOnly) {
            args.push('-f', 'bestaudio/best', '-x', '--audio-format', 'mp3');
            if (audioQuality && audioQuality !== 'best') args.push('--audio-quality', audioQuality);
        } else {
            if (quality === 'best' || parseInt(quality) > 720) {
                args.push('-f', 'bestvideo[height<=' + (quality === 'best' ? '99999' : quality) + ']+bestaudio/best[height<=' + (quality === 'best' ? '99999' : quality) + ']/best');
                args.push('--merge-output-format', 'mp4');
            } else {
                const height = quality === 'best' ? 'best' : `best[height<=${quality}]`;
                args.push('-f', `${height}[ext=mp4]/best[ext=mp4]/best`);
            }
        }
        
        args.push(videoUrl);
        const ytDlp = spawn('yt-dlp', args);
        res.setHeader('Content-Type', audioOnly ? 'audio/mpeg' : 'video/mp4');
        res.setHeader('Content-Disposition', `attachment; filename="download.${audioOnly ? 'mp3' : 'mp4'}"`);
        ytDlp.stdout.pipe(res);
        ytDlp.stderr.on('data', d => console.error(d.toString()));
        ytDlp.on('close', code => {
            if (code !== 0 && !res.headersSent) res.status(500).send('Download failed');
            res.end();
        });
        ytDlp.on('error', e => {
            if (!res.headersSent) res.status(500).send(e.message);
        });
    }
});

app.use(express.static(__dirname));
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
