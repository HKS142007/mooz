import { createServer } from 'http'
import { Server, Socket } from 'socket.io'
import { nanoid } from 'nanoid'
import NodeCache from 'node-cache'

const SERVER_OPTIONS = { cors: { origin: '*' } }

const httpServer = createServer()
const io = new Server(httpServer, SERVER_OPTIONS)

const roomsCache = new NodeCache({
    /*
     12 hours expiry. 
     It is long enough to last for any meeting (too long) and shoudn't be needed normally, just for the case i fuck up somewhere
    */
    stdTTL: 43200,
})

interface Room {
    id: string // client version of Room may have id optional
    created_by?: string
    name?: string
    opts?: {
        maxPeople?: string // will be int parsed when used
    }
}

io.on('connection', (socket: Socket) => {
    console.log('socket connected', socket.id)

    socket.on('create_room', (room: Room, cb) => {
        try {
            // TOTHINK is anybody really gonna be able to just create a room 😶
            const roomId = nanoid()
            room.id = roomId

            socket.join(roomId)
            roomsCache.set<Room>(roomId, room)
            io.to(socket.id).emit('room_joined', room)

            cb({ isError: false })
        } catch (err) {
            console.error(err)
            cb({ isError: true })
        }
    })

    socket.on('join_room', (opts, cb) => {
        try {
            const { name, link } = opts
            const room = getRoomFromLink(link) // throws error on no room

            socket.join(room.id)
            socket.to(room.id).emit('person_joined', {
                name,
                socketId: socket.id,
            })
            io.to(socket.id).emit('room_joined', room)

            cb({ isError: false })
        } catch (err) {
            console.error(err)
            cb({ isError: true })
        }
    })

    socket.on('leave_room', () => {
        try {
            // socket should be just be in one room
            socket.rooms.forEach(room => {
                if (room === socket.id) return

                socket.leave(room)
                socket.to(room).emit('person_left', {
                    socketId: socket.id,
                })
                io.in(room)
                    .allSockets()
                    .then(sockets => {
                        if (sockets.size === 0) {
                            // room is now empty, clear the memory reference
                            roomsCache.del(room)
                        }
                    })
            })
        } catch (err) {
            console.error(err)
        }
    })

    /*
     messages ('message' events) are send as is to other socket specified by `to` key in data 
     `to` key is removed and `from` is added in delivered message 
    */
    socket.on('message', message => {
        const { to, ...msg } = message
        socket.to(to).send({
            from: socket.id,
            ...msg
        })
    })

    socket.on('disconnecting', reason => {
        // will leave socket rooms automatically. socket.leave(rooms)
        socket.rooms.forEach(room => {
            if (room !== socket.id) {
                io.to(room).emit('person_left', {
                    socketId: socket.id,
                })
                io.in(room)
                    .allSockets()
                    .then(sockets => {
                        if (sockets.size === 0) {
                            roomsCache.del(room)
                        }
                    })
            }
        })
    })
})
const PATH_REGEX = /^\/room\/(?<id>[A-Za-z0-9_-]+)/
const ID_REGEX = /^(?<id>[A-Za-z0-9_-]+)/

function getRoomFromLink(link: string): Room {
    let id: string | undefined
    if (link.match(ID_REGEX)?.groups?.id) {
        // link is already a id
        id = link
    } else {
        const url = new URL(link) // throws if url is invalid
        /* This does not care about url host so any host is valid as long as that follows below pathname pattern
           /room/<room_id>
           room_id regex = ([A-Za-z0-9_-])+ (same as nanoid character set)
        */
        id = url.pathname.match(PATH_REGEX)?.groups?.id
    }

    if (!id) throw Error('Invalid link format')
    if (!roomsCache.has(id)) throw Error('Room not found')

    return roomsCache.get(id) as Room
}

httpServer.listen(5000, () => {
    console.log('listening on port', 5000)
})
