import express from 'express';
import {matchRouter} from "./routes/matches.js";
import http from 'http';


const app = express();
const PORT = process.env.PORT || 8000;
const HOST = process.env.HOST || '0.0.0.0';

const server = http.createServer(app);

app.use(express.json());

app.get('/', (req, res) => {
    res.send('Hello from Express server!');
});

app.use('/matches', matchRouter)

app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});
