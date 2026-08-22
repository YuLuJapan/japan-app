import './index.css'
import { Composition } from 'remotion'
import { OnwardPromo } from './OnwardPromo'
import { DURATION } from './onward/script'
import { FPS, SIZE } from './onward/theme'

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="OnwardPromo"
      component={OnwardPromo}
      durationInFrames={DURATION}
      fps={FPS}
      width={SIZE}
      height={SIZE}
      defaultProps={{ voiceover: false }}
    />
  )
}
