import {planIntent} from './intent-engine.js?v=db3639e20a8c';
self.onmessage = ({data}) => {
  try {
    self.postMessage({result: planIntent(data.intent, data.catalogue, data.options)});
  } catch (error) {
    self.postMessage({error: error.message});
  }
};
