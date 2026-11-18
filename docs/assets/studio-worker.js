import {planIntent} from './intent-engine.js?v=8b12d09c0019';
self.onmessage = ({data}) => {
  try {
    self.postMessage({result: planIntent(data.intent, data.catalogue, data.options)});
  } catch (error) {
    self.postMessage({error: error.message});
  }
};
