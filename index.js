const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

app.use(
  cors({
    origin: ['http://localhost:5173'],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

// JWT middleware
const verifyJWT = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).send({ message: 'Unauthorized' });
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).send({ message: 'Forbidden' });
    req.user = decoded;
    next();
  });
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@signatureelite.z7ote26.mongodb.net/?retryWrites=true&w=majority&appName=SignatureElite`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    const propertiesCollection = client
      .db('signatureElite')
      .collection('properties');

    const wishlistCollection = client
      .db('signatureElite')
      .collection('wishlists');

    // JWT issue route
    app.post('/jwt', async (req, res) => {
      try {
        const user = req.body;
        const token = jwt.sign(user, process.env.JWT_SECRET, {
          expiresIn: '7d',
        });
        res.send({ token });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Error generating token' });
      }
    });

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

    app.get('/property/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const property = await propertiesCollection.findOne({
          _id: new ObjectId(id),
        });
        res.send(property);
      } catch (error) {
        res.status(500).send({ message: 'Error fetching property' });
      }
    });

    // GET and add to wishlist:
    app.get('/wishlist', verifyJWT, async (req, res) => {
      try {
        const userEmail = req.query.userEmail;
        const items = await wishlistCollection.find({ userEmail }).toArray();
        res.send(items);
      } catch (error) {
        res.status(500).send({ message: 'Error fetching wishlist' });
      }
    });

    app.post('/wishlist', verifyJWT, async (req, res) => {
      try {
        const item = req.body;
        await wishlistCollection.insertOne(item);
        res.send({ message: 'Added to wishlist' });
      } catch (error) {
        res.status(500).send({ message: 'Error adding to wishlist' });
      }
    });

    await client.db('admin').command({ ping: 1 });
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    );
  } finally {
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
