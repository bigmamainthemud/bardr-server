// require('dotenv').config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const upload = multer();
const fetch = require('node-fetch');
const { marked } = require('marked');

const { VertexAI } = require("@google-cloud/vertexai");
// const dialogflow = require('@google-cloud/dialogflow');
// const { SessionsClient } = require('@google-cloud/dialogflow');

const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const stream = require('stream');

const { SpeechClient } = require('@google-cloud/speech');
const bodyParser = require('body-parser');
const app = express();
const port = 3000;

const corsOptions = {
  origin: 'http://localhost:4200'
};

app.use(bodyParser.raw({ type: 'audio/ogg', limit: '10mb' }));
app.use(bodyParser.json()); 
app.use(cors(corsOptions));

const speechClient = new SpeechClient();

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

  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Error processing request');
  }
});


// AI
app.post('/ai-response', async (req, res) => {
  const model = 'gemini-pro';
  const projectId = 'bardr-agent-ukxi';
  const location = 'us-central1';
  const image = 'gs://generativeai-downloads/images/scones.jpg'; // Google Cloud Storage image
  const mimeType = 'image/jpeg';
  const vertexAI = new VertexAI({project: projectId, location: location});
  const generativeVisionModel = vertexAI.preview.getGenerativeModel({
    model: model, 
  });

  // For images, the SDK supports both Google Cloud Storage URI and base64 strings
  // const filePart = {
  //   fileSata: {
  //     fileUri: image,
  //     mimeType: mimeType,
  //   },
  // };

// Dialogflow version ///////////////////////
// const projectId = 'bardr-agent-ukxi';//"bardr-ring";
// const uuid = require('uuid');
// const sessionId = uuid.v4(); 
// const client = new dialogflow.SessionsClient({ projectId });
// const client = new SessionsClient({ projectId });

// // Define the session and query
// const sessionPath = client.sessionPath(projectId, sessionId);
// const query = { text: req.body.transcription };
// const fullTextResponse = await client.detectIntent({ sessionPath, query });
//////////////////////////////////////////////

  console.log(req.body.transcription);
  const textPart = { text: req.body.transcription };
  const ai_request = {
    // contents: [{role: 'user', parts: [textPart, filePart]}],
    contents: [{role: 'user', parts: [textPart]}],
  };

  console.log('Prompt Text:', ai_request.contents[0].parts[0].text);
  console.log('Non-Streaming Response Text:');

  const responseStream = await generativeVisionModel.generateContentStream(ai_request);
  const aggregatedResponse = await responseStream.response; 
  const fullTextResponse = aggregatedResponse.candidates[0].content.parts[0].text;
  console.log(fullTextResponse);

  const htmlText = marked(fullTextResponse);
  res.send({ aiResponse: htmlText });
});


// RUNNING
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});


async function convertAudioToLinear16(audioBuffer) {
  return new Promise((resolve, reject) => {
    console.log('Buffer type:', typeof audioBuffer);
    console.log('Buffer instance:', audioBuffer instanceof Buffer);
    console.log('Buffer length:', audioBuffer.length);
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



