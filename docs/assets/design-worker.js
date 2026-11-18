import { planDesign } from "./design-engine.js?v=c008cadea6e8";
import {findTestedRevision} from './brief-revisions.js?v=c008cadea6e8';
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
