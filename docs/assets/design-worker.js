import { planDesign } from "./design-engine.js?v=6ea6e943cea0";
import {findTestedRevision} from './brief-revisions.js?v=6ea6e943cea0';
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
