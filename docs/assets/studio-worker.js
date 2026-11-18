import {planIntent} from './intent-engine.js?v=9b8d8e12b3f3';
self.onmessage = ({data}) => {
  try {
    self.postMessage({result: planIntent(data.intent, data.catalogue, data.options)});
  } catch (error) {
    self.postMessage({error: error.message});
  }
};
