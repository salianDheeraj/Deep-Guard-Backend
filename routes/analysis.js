/* 
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const UPLOADS_FOLDER = path.join(__dirname, '../uploads');

// mock part for tesrting
async function Analysis(videoPath) {
  console.log('Analyzing', videoPath);
  return {
    label: Math.random() > 0.5 ? 'real' : 'fake',
    confidence: Math.random().toFixed(2),
  };
}

// analysisfile upload
router.post('/',async(req,res)=>{
            const {videoName}=req.body;
            if (!videoName) return res.status(400).json();
            const videoPath = path.join(UPLOADS_FOLDER, videoName);
// if file doesn't exist
console.log('Server is checking for file at:', videoPath); 
            if(!fs.existsSync(videoPath)){
                return res.status(404).json();
            }
// if file exits
            try{
                const result=await Analysis(videoPath);
                
                res.status(200).json({ videoName, ...result });
            }catch (err) {
             console.error(err);
              res.status(500).json({ error: 'Analysis failed' });
  }
});
module.exports = router; */