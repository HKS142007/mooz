import { mergeStyles } from '@fluentui/react'
import { useEffect, useRef } from 'react'
import type { FunctionComponent } from 'react'

const videoCLassname = mergeStyles({
    display: 'block',
    width: '100%',
    height: '100%',
})
interface VideoBoxProps {
    stream: MediaStream
    muted?: boolean
}
/* eslint-disable jsx-a11y/media-has-caption */
const VideoBox: FunctionComponent<VideoBoxProps> = ({ stream, muted = false }) => {
    const videoElem = useRef<HTMLVideoElement | null>(null)
    useEffect(() => {
        const video = videoElem.current
        if (video) {
            video.srcObject = stream
            video.oncanplay = () => video.play()
        }
    }, [stream, videoElem])

    return (
        <video
            ref={videoElem}
            className={videoCLassname}
            controls={false}
            muted={muted}
            autoPlay
            playsInline
        >
            Seriously, How old are you and your browser!
        </video>
    )
}

export default VideoBox
