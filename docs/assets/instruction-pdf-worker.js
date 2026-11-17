import { createInstructionPdf } from "./instruction-pdf.js?v=ea85888e5541";
import { ASSET_VERSION } from "./release-version.js?v=ea85888e5541";

self.onmessage = async ({data: {plan, profiles, spec}}) => {
  try {
    const fontUrl = new URL(`../data/pdf-font-v1.json?v=${ASSET_VERSION}`, import.meta.url);
    const response = await fetch(fontUrl);
    if (!response.ok) throw new Error("Could not load the instruction font. Try exporting again.");
    const catalogue = {profiles, pdf_font: await response.json()};
    const bytes = await createInstructionPdf(plan, catalogue, spec, (page, total) => {
      self.postMessage({page, total});
    });
    self.postMessage({bytes}, [bytes.buffer]);
  } catch (error) {
    self.postMessage({error: error.message});
  }
};
