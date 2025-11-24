const multer = require('multer');
const path = require('path');

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedFormats = ['.jpg', '.jpeg', '.png', '.mp4'];
  const fileExt = path.extname(file.originalname).toLowerCase();
  
  if (allowedFormats.includes(fileExt)) {
    cb(null, true);
  } else {
    cb(new Error('Unsupported file format'));
  }
};

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter
});

module.exports = upload;
