const express = require('express');
const cors = require('cors');
const app = express();
require('dotenv').config();
const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion } = require('mongodb');
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@signatureelite.z7ote26.mongodb.net/?retryWrites=true&w=majority&appName=SignatureElite`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // const db = client.db('signatureElite');
    const propertiesCollection = client
      .db('signatureElite')
      .collection('properties');

    // Route: GET /all-properties
    app.get('/all-properties', async (req, res) => {
      try {
        const { search = '', sort = '' } = req.query;

        const query = {
          verificationStatus: 'verified',
        };

        if (search) {
          query.location = { $regex: search, $options: 'i' };
        }

        let sortOption = {};
        if (sort === 'asc') {
          sortOption.minPrice = 1;
        } else if (sort === 'desc') {
          sortOption.minPrice = -1;
        }

        const properties = await propertiesCollection
          .find(query)
          .sort(sortOption)
          .toArray();

        res.send(properties);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Server error fetching properties' });
      }
    });
    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 });
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Welcome To Signature Elite');
});

app.listen(port, () => {
  console.log(`Signature Elite server is running on port ${port}`);
});
