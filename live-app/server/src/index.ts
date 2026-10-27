import mongoose from 'mongoose';
import { app } from './app';
import { config } from './config';

mongoose.connect(config.mongoUri).then(() => {
  app.listen(config.port, () => console.log(`API listening on :${config.port}`));
});
