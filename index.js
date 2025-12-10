const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

require("dotenv").config();
const cors = require('cors');
const multer = require('multer');
const path = require('path');

app.use(express.json());
app.use(cors());

// Serve uploaded images
app.use('/uploads', express.static('uploads'));

// Multer storage configuration
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, './uploads'); // save to ./uploads
  },
  filename: function(req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname)); // unique filename
  }
});

const upload = multer({ storage });

// MongoDB setup
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@mongopractice.2tbsahv.mongodb.net/?appName=MongoPractice`;
const client = new MongoClient(uri, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
});

async function run() {
  try {
    await client.connect();
    const ticketDB = client.db("ticketbari-db");
    const ticketCollection = ticketDB.collection("tickets");

    // Ticket creation
    app.post('/tickets', async (req, res) => {
      const ticket = req.body;
      const result = await ticketCollection.insertOne(ticket);
      res.send(result);
    });

     app.get('/tickets/vendor/:email', async (req, res) => {
      const email = req.params.email;

      const tickets = await ticketCollection
        .find({ vendorEmail: email })
        .toArray();

      res.send(tickets);
    });


   app.delete('/tickets/:id', async (req, res) => {
  const id = req.params.id;
  const { ObjectId } = require('mongodb');

  try {
    const result = await ticketCollection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).send({ message: "Ticket not found" });
    }

    res.send({ message: "Deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Server error" });
  }
});

   








    // Image upload route
    app.post('/api/upload', upload.single('image'), (req, res) => {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const imageUrl = `http://localhost:${port}/uploads/${req.file.filename}`;
      res.json({ url: imageUrl });
    });

    console.log("MongoDB connected and routes are ready");
  } finally {
    // client.close() // keep connection alive
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Hello World!');
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});