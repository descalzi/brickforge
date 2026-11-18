import { planDesign } from "./design-engine.js?v=8b12d09c0019";
import {findTestedRevision} from './brief-revisions.js?v=8b12d09c0019';
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
