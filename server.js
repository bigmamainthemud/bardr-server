const express = require('express');
const cors = require('cors');
const multer = require('multer');
const upload = multer();
const fetch = require('node-fetch');
const { marked } = require('marked');
const { VertexAI } = require("@google-cloud/vertexai");
const fs = require('fs');

const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const stream = require('stream');

const { SpeechClient } = require('@google-cloud/speech');
const textToSpeech = require('@google-cloud/text-to-speech')
const bodyParser = require('body-parser');
const app = express();
const port = 3000;

const corsOptions = {
  origin: 'http://localhost:4200'
};

app.use(bodyParser.raw({ type: 'audio/ogg', limit: '10mb' }));
app.use(bodyParser.json()); 
app.use(cors(corsOptions));
app.use(express.static('public'));

const speechClient = new SpeechClient();
const TTSclient = new textToSpeech.TextToSpeechClient()

// SPEECH-TO-TEXT
app.post('/transcribe', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded.');
  }

  try {
    const convertedAudioBuffer = await convertAudioToLinear16(req.file.buffer);
    const audioBytes = convertedAudioBuffer.toString('base64');
    
    const request = {
      audio: {
        content: audioBytes,
      },
      config: {
        encoding: 'LINEAR16',
        sampleRateHertz: 48000,
        languageCode: 'en-US',
      },
    };

    const [response] = await speechClient.recognize(request);
    const transcription = response.results
      .map(result => result.alternatives[0].transcript)
      .join('\n');
    
    res.send({ transcription });
    // res.send({ transcription: "How many feet are in a mile" }); // 1 click testing so you don't have to talk

  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Error processing request');
  }
});


app.post('/ai-response', async (req, res) => {
  try {
    const vertexAI = new VertexAI({ project: 'bardr-ring', location: 'us-central1' });
    const generativeModel = vertexAI.preview.getGenerativeModel({ model: 'gemini-pro' });
    const chat = generativeModel.startChat({});
    const chatInput1 = req.body.transcription;
    const responseStream = await chat.sendMessageStream(chatInput1);
    const aggregatedResponse = await responseStream.response;
    const fullTextResponse = aggregatedResponse.candidates[0].content.parts[0].text;
    const htmlText = marked(fullTextResponse);

    // AUDIO RESPONDER
    const request = {
      input: { text: fullTextResponse },
      voice: { languageCode: 'en-US', ssmlGender: 'NEUTRAL' },
      audioConfig: { audioEncoding: 'MP3' },
    };
    const [response] = await TTSclient.synthesizeSpeech(request);
    // console.log('Response from TTSclient:', response); 

    if (response.audioContent) {
      fs.writeFile(`public/output.mp3`, response.audioContent, (err) => {
        if (err) {
          console.error('Error writing audio file:', err);
          return;
        }
      });
      res.json({ aiTextResponse: htmlText, audioContent: 'http://localhost:3000/output.mp3' });

    } else {
      res.json({ aiTextResponse: htmlText });
    }

  } catch (error) {
    console.error('Server Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


// RUNNING
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

async function convertAudioToLinear16(audioBuffer) {
  return new Promise((resolve, reject) => {
    // console.log('Buffer type:', typeof audioBuffer);
    // console.log('Buffer instance:', audioBuffer instanceof Buffer);
    // console.log('Buffer length:', audioBuffer.length);
    // console.log('Buffer content (snippet):', audioBuffer.slice(0, 100).toString('hex'));

    // Create a readable stream from the buffer
    const readableStream = new stream.Readable({
      read() {}
    });
    readableStream.push(audioBuffer);
    readableStream.push(null);

    let outputBuffer = Buffer.alloc(0);

    ffmpeg()
      .setFfmpegPath(ffmpegPath)
      .input(readableStream)
      .audioCodec('pcm_s16le')
      .audioFrequency(48000)
      .format('wav') 
      .on('end', () => resolve(outputBuffer))
      .on('error', (err) => reject(err))
      .pipe(new stream.Writable({
        write: function (chunk, encoding, callback) {
          outputBuffer = Buffer.concat([outputBuffer, chunk]);
          callback();
        }
      }));
  });
}