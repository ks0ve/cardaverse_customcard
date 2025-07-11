import { Shopify, ApiVersion } from '@shopify/shopify-api';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';

// Disable default body parsing so multer can handle multipart/form-data
export const config = {
  api: { bodyParser: false }
};

// Initialize Multer for file uploads
const upload = multer();

// Initialize Shopify API context for HMAC verification
if (!Shopify.Context.INITIALIZED) {
  Shopify.Context.initialize({
    API_KEY:         process.env.SHOPIFY_API_KEY,
    API_SECRET_KEY:  process.env.SHOPIFY_API_SECRET,
    SCOPES:          [],  // No additional Shopify scopes needed
    HOST_NAME:       process.env.HOST_NAME.replace(/^https?:\/\//, ''),
    API_VERSION:     ApiVersion.July24,
    IS_EMBEDDED_APP: false,
    SESSION_STORAGE: new Shopify.Session.MemorySessionStorage(),
  });
}

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// HMAC verification middleware
function verifyHMAC(query) {
  return Shopify.Utils.validateHmac(query, process.env.SHOPIFY_API_SECRET);
}

// Vercel serverless handler
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  const { shop, timestamp, hmac } = req.query;
  if (!shop || !timestamp || !hmac || !verifyHMAC(req.query)) {
    return res.status(401).json({ error: 'Invalid or missing HMAC/shop/timestamp' });
  }

  // Parse multipart/form-data
  await new Promise((resolve, reject) => {
    upload.single('pdf')(req, res, err => err ? reject(err) : resolve());
  });

  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ error: 'No PDF file uploaded' });
  }

  try {
    // Upload PDF buffer to Cloudinary as a raw file
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'raw',
          public_id:     `cards/card_${Date.now()}`,
          folder:        'cards'
        },
        (error, result) => error ? reject(error) : resolve(result)
      );
      stream.end(req.file.buffer);
    });

    return res.status(200).json({ file_url: result.secure_url });
  } catch (error) {
    console.error('Cloudinary upload failed:', error);
    return res.status(500).json({ error: 'Upload to Cloudinary failed' });
  }
}
