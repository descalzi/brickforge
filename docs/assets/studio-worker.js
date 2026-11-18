import {planIntent} from './intent-engine.js?v=c008cadea6e8';
self.onmessage = ({data}) => {
  try {
    self.postMessage({result: planIntent(data.intent, data.catalogue, data.options)});
  } catch (error) {
    self.postMessage({error: error.message});
  }
};
