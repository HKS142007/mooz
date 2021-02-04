import { FunctionComponent, useCallback, useEffect, useRef } from 'react'
import { useRecoilState, useRecoilValue, useSetRecoilState } from 'recoil'
import Peer from 'simple-peer'
import { updateBandwidthRestriction } from '../../utils/helpers'
import {
    addMessageSelector,
    preferencesState,
    remoteStreamsState,
    socketState,
    userStreamState,
    PeerData,
    Message,
    displayStreamState,
} from '../../atoms'
import { MoozPeer } from '../../react-app-env'
import toast, { Timeout, ToastType } from '../../comps/toast'
import { MAX_BITRATE } from '../../utils/settings'

interface SignalMessage {
    from: string
    signal?: any // eslint-disable-line @typescript-eslint/no-explicit-any
}

interface PeerProps extends Peer.Options {
    partnerId: string
    partnerName?: string
}

type ErrorCodes =
    | 'ERR_WEBRTC_SUPPORT'
    | 'ERR_CREATE_OFFER'
    | 'ERR_CREATE_ANSWER'
    | 'ERR_SET_LOCAL_DESCRIPTION'
    | 'ERR_SET_REMOTE_DESCRIPTION'
    | 'ERR_ADD_ICE_CANDIDATE'
    | 'ERR_ICE_CONNECTION_FAILURE'
    | 'ERR_SIGNALING'
    | 'ERR_DATA_CHANNEL'
    | 'ERR_CONNECTION_FAILURE'

interface PeerError {
    code: ErrorCodes
}

const createSdpTransform = (bitrate: number) => (sdp: string) =>
    updateBandwidthRestriction(sdp, bitrate)

const PeerComponent: FunctionComponent<PeerProps> = props => {
    const addMessage = useSetRecoilState(addMessageSelector)
    const preferences = useRecoilValue(preferencesState)
    const { partnerId, partnerName, ...opts } = props
    const [remoteStreams, setRemoteStreams] = useRecoilState(remoteStreamsState)
    const remoteStreamRef = useRef(new MediaStream())
    const userStream = useRecoilValue(userStreamState)
    const displayStream = useRecoilValue(displayStreamState)

    const socket = useRecoilValue(socketState)

    const peerRef = useRef<Peer.Instance>()
    if (!peerRef.current) {
        peerRef.current = new Peer({
            // eslint-disable-next-line
            sdpTransform: createSdpTransform(MAX_BITRATE) as any,
            ...opts,
        })
    }

    const saveInstance = () => {
        const peer = peerRef.current as Peer.Instance
        const moozPeer: MoozPeer = { peer, partnerId }
        if (!window.moozPeers) window.moozPeers = [moozPeer]

        // remove old copy
        window.moozPeers = window.moozPeers.filter(p => p.partnerId !== partnerId)

        // update
        window.moozPeers.push(moozPeer)
    }
    saveInstance()

    const onRemoteStream = useCallback(
        (stream: MediaStream) => {
            // console.log('onStream', stream.getTracks())
            const remoteStream = remoteStreamRef.current
            // remove prev tracks
            remoteStream.getTracks().forEach(t => {
                t.stop()
                remoteStream.removeTrack(t)
            })
            let rStreams = remoteStreams

            // check for display stream
            const videoTracks = stream.getVideoTracks()
            if (videoTracks.length > 1) {
                const displayTrack = videoTracks[1] // TODO 1?
                stream.removeTrack(displayTrack)
                const rdStream = new MediaStream([displayTrack])
                rStreams = rStreams
                    .filter(r => !r.isDisplay)
                    .concat({ stream: rdStream, isDisplay: true, partnerId })
            }

            // add new tracks
            stream.getTracks().forEach(t => remoteStream.addTrack(t))

            // save if not already
            const present = remoteStreams.find(s => s.partnerId === partnerId && !s.isDisplay)
            if (!present) {
                rStreams.push({ partnerId, stream: remoteStream })
            }
            setRemoteStreams(rStreams)
        },
        [setRemoteStreams, remoteStreams, partnerId],
    )

    useEffect(() => {
        const peer = peerRef.current as Peer.Instance
        const onMessageRecieved = (msg: SignalMessage) => {
            const { signal, from } = msg
            if (signal && from === partnerId) {
                try {
                    peer.signal(signal)
                } catch (err) {
                    // console.error(err)
                }
            }
        }
        const onConnected = () => {
            toast(`Connected with peer ${partnerName}`, { type: ToastType.success })
        }
        const onClose = () => {
            toast(`Connection closed with peer ${partnerName}`, { type: ToastType.severeWarning })
        }
        const onError = (err: PeerError) => {
            if (err.code === 'ERR_WEBRTC_SUPPORT') {
                toast(`No WebRTC support, are you on grandpa's computer?`, {
                    type: ToastType.error,
                })
            } else if (err.code === 'ERR_CONNECTION_FAILURE') {
                toast(`WebRTC connection failure`, {
                    type: ToastType.error,
                })
            }
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const onLocalSignal = (signal: any) => {
            socket.send({
                to: partnerId,
                signal,
            })
        }
        const onDataRecieved = (str: string) => {
            try {
                const data: PeerData = JSON.parse(str)
                if (data.message) {
                    const msg: Message = {
                        ...data.message,
                        mine: false,
                    }
                    addMessage([msg])
                    toast(`New message from ${msg.author}: ${msg.text}`, {
                        type: ToastType.info,
                    })
                }
            } catch (err) {
                toast(`Peer data error`, {
                    type: ToastType.error,
                    autoClose: Timeout.SHORT,
                })
            }
        }

        peer.on('stream', onRemoteStream)
        peer.on('signal', onLocalSignal)
        peer.on('data', onDataRecieved)
        peer.on('connect', onConnected)
        peer.on('close', onClose)
        peer.on('error', onError)

        socket.on('message', onMessageRecieved)

        return () => {
            peer.off('stream', onRemoteStream)
            peer.off('signal', onLocalSignal)
            peer.off('connect', onConnected)
            peer.off('data', onDataRecieved)
            peer.off('close', onClose)
            peer.off('error', onError)

            socket.off('message', onMessageRecieved)
        }
    }, [onRemoteStream, socket, partnerId, addMessage, partnerName])

    useEffect(() => {
        const peer = peerRef.current as Peer.Instance
        const tracks = [...userStream?.getTracks() || [], ...displayStream?.getVideoTracks() || []]
        let stream: MediaStream | undefined
        if (tracks.length) stream = new MediaStream(tracks)
        try {
            if (stream) {
                peer.addStream(stream)
            }
        } catch (err) {
            // console.error(err)
        }
        return () => {
            try {
                if (stream) {
                    peer.removeStream(stream)
                }
            } catch (err) {
                // console.error(err)
            }
        }
    }, [userStream, displayStream])

    // send proposal to partner to join
    useEffect(() => {
        if (!opts.initiator) {
            socket.send({
                to: partnerId,
                proposal: true,
                name: preferences.name,
            })
        }
    }, []) // eslint-disable-line

    // destroy peer and remote stream when component exits
    useEffect(
        () => () => {
            peerRef.current?.destroy()
            remoteStreamRef.current.getTracks().forEach(t => {
                t.stop()
                remoteStreamRef.current.removeTrack(t)
            })
        },
        [],
    )

    return null
}

export default PeerComponent
