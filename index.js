const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
require('dotenv').config();


const port = process.env.PORT || 5000;

const app = express();

// middleware
app.use(cors());
app.use(express.json());


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ldgxyyy.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

function verifyJWT(req, res, next){
  // console.log('token: ', req.headers.authorization);
  const authHeader = req.headers.authorization;
  if(!authHeader){
    return res.status(401).send('unauthorized access');
  }

  const token = authHeader.split(' ')[1];
  // console.log(token);

  jwt.verify(token, process.env.ACCESS_TOKEN, function(err, decoded){
    if(err){
      return res.status(403).send({message: 'forbidden access'})
    }

    req.decoded = decoded;
    
    next();

  })

}

async function run() {
  try {
    const availableAppointmentsCollection = client.db("doctorsPortal").collection("availableAppointments");
    const bookingAppointmentsCollection = client.db("doctorsPortal").collection("bookingAppointments");
    const usersCollection = client.db("doctorsPortal").collection("users");

    // Use Aggregate to query multiple collection and then merge data
    app.get('/availableAppointments', async (req, res) => {
      const date = req.query.date;
      // console.log(date);
      const query = {};
      const appointments = await availableAppointmentsCollection.find(query).toArray();

      // get the bookings of the provided date
      const bookingQuery = { appointmentDate: date };
      const alreadyBooked = await bookingAppointmentsCollection.find(bookingQuery).toArray();


      appointments.forEach(appoint => {
        const appointmentBooked = alreadyBooked.filter(book => book.treatmentTitle === appoint.name);
        const bookedSlots = appointmentBooked.map(book => book.slot)
        const remainingSlots = appoint.slots.filter(slot => !bookedSlots.includes(slot))
        appoint.slots = remainingSlots;

        // console.log(remainingSlots)
        // console.log(date, appoint.name, bookedSlots)
      })

      res.send(appointments);

    });

    app.get('/v2/availableAppointments', async (req, res) => {
      const date = req.query.date;
      const options = await availableAppointmentsCollection.aggregate([
        {
          $lookup: {
            from: 'bookingAppointments',
            localField: 'name',
            foreignField: 'treatmentTitle',
            pipeline: [
              {
                $match: {
                  $expr: {
                    $eq: ['$appointmentDate', date]
                  }
                }
              }
            ],
            as: 'booked'
          }
        },
        {
          $project: {
            name: 1,
            slots: 1,
            booked: {
              $map: {
                input: '$booked',
                as: 'book',
                in: '$$book.slot'
              }
            }
          }
        },
        {
          $project: {
            name: 1,
            slots: {
              $setDifference: ['$slots', '$booked']
            }
          }

        }

      ]).toArray();
      res.send(options)
    })

    /*

    API Naming Convention
    app.get('')
    app.post('')
    app.patch('')
    app.delete('');
    
    */


    // read
    app.get('/bookings', verifyJWT, async (req, res) => {
      const email = req.query.email;
      const decodedEmail = req.decoded.email;

      if(decodedEmail !== email){
        return res.status(403).send({message: 'forbidden access'});
      }
      const query = {email: email};
      const bookings = await bookingAppointmentsCollection.find(query).toArray();
      res.send(bookings);

    })

    // jwt token
    app.get('/jwt', async(req, res) => {
      const email = req.query.email;
      const query = {email:email};
      const user = await usersCollection.findOne(query);
      
      if(user && user.email) {
        // const token = jwt.sign({email}, process.env.ACCESS_TOKEN);
        const token = jwt.sign({email}, process.env.ACCESS_TOKEN, { expiresIn: '5h' });
        return res.send({accessToken: token})
      }
      // console.log(user);
      res.status(403).send({accessToken: ''});
    })


    // User related API ---> (start..)

    app.get('/users', async (req, res)=> {
      const query = {};
      const users = await usersCollection.find(query).toArray();
      res.send(users);
    })

    app.get('/users/admin/:email', async(req, res)=> {
      const email = req.params.email;
      const query = {email}
      const user = await usersCollection.findOne(query)
      res.send({ isAdmin: user?.role === 'admin' });
      // console.log(user.email);
    });

    // update user (PUT or PATCH)
    // patch - only update a field value
    // put - update and create/insert a field

    app.put('/users/admin/:id', verifyJWT, async(req, res)=> {
      const decodedEmail = req.decoded.email;
      const query = {email: decodedEmail};
      const user = await usersCollection.findOne(query);
      if(user?.role !== 'admin') {
        return res.status(403).send({message: 'forbidden access'})
      }

      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const options = {upsert: true};
      const updateDoc = {
        $set: {
          role: 'admin'
        }
      }
      const result = await usersCollection.updateOne(filter, updateDoc, options);
      res.send(result);

    })

    // insert or write

    app.post('/users', async(req, res)=> {
      const user = req.body;
      // console.log(user);
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    // User related API ---> (end)

    app.post('/bookingAppointments', async (req, res) => {
      const booking = req.body;
      // console.log(booking);
      const query = {
        appointmentDate: booking.appointmentDate,
        email: booking.email,
        treatmentTitle: booking.treatmentTitle,

      }

      const alreadyBooked = await bookingAppointmentsCollection.find(query).toArray();

      if (alreadyBooked.length) {
        const message = `You have an already booking at ${booking.appointmentDate}`
        return res.send({ acknowledged: false, message })

      }


      const result = await bookingAppointmentsCollection.insertOne(booking);
      res.send(result);
    });


  }
  finally {

  }

}

run().catch(console.dir);



app.get('/', async (req, res) => {
  res.send('doctors portal server is running..')
})

app.listen(port, () => {
  console.log(`Doctors portal running on ${port}`)
})

/* 

------ create token -----

-> node
-> require('crypto').randomBytes(64)
-> require('crypto').randomBytes(64).toString()
-> require('crypto').randomBytes(64).toString('hex')



*/
