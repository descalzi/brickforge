import {planIntent} from './intent-engine.js?v=fab991c95518';
self.onmessage = ({data}) => {
  try {
    self.postMessage({result: planIntent(data.intent, data.catalogue, data.options)});
  } catch (error) {
    self.postMessage({error: error.message});
  }
};
