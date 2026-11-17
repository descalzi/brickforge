import { planDesign } from "./design-engine.js?v=d0896f9f9a9d";
import {findTestedRevision} from './brief-revisions.js?v=d0896f9f9a9d';
self.onmessage = ({data}) => {
  try {
    if (data.action === 'find_revision') {
      const revision = findTestedRevision(data.spec, data.catalogue, data.options, data.failure);
      self.postMessage({revision});
      return;
    }
    const result = planDesign(data.spec, data.catalogue, data.options);
    self.postMessage({result});
  } catch (error) {
    self.postMessage({error: error.message});
  }
};
