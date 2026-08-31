import React from "react";
import { Composition } from "remotion";
import { ADyingArtTitle } from "./ADyingArtTitle";
export const TitleRoot: React.FC = () => (
  <Composition id="ADyingArtTitle" component={ADyingArtTitle} durationInFrames={150} fps={30} width={1920} height={1080} />
);
