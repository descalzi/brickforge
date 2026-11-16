import { planDesign } from "./design-engine.js?v=07b56d3093e4";
self.onmessage = ({data}) => {
  try {
    const result = planDesign(data.spec, data.catalogue, data.options);
    self.postMessage({result});
  } catch (error) {
    self.postMessage({error: error.message});
  }
};
