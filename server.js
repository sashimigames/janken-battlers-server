// ============================================================
//  ジャンケンバトラーズ - オンライン対戦リレーサーバー
// ============================================================
// 方式: 「リレー」— このサーバーはダメージ計算などのゲームロジックを
// 一切持たない。両プレイヤーの「手」や「デッキ」をお互いに送り合う
// だけの中継役。実際の勝敗判定は両クライアント（ゲーム本体のHTML）が
// それぞれ同じロジックでローカル計算する。
//
// メリット: 実装が小さく速い。友達同士のカジュアル対戦には十分。
// デメリット: 改造されたクライアントが自己申告する手を偽ることは
//   理論上可能（サーバー側で「本当にその手だったか」を検証しない）。
//   本格的な不正対策が必要になったら、ここにダメージ計算ロジックを
//   移植してサーバー権威型に強化できる（今回はその手前の段階）。
// ============================================================

const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
app.use(cors());
app.get('/', (req, res) => {
  res.send('janken-battlers relay server: OK');
});
// Render等のヘルスチェック用
app.get('/healthz', (req, res) => res.status(200).send('ok'));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

const PORT = process.env.PORT || 3000;

// ---- ルーム管理 ----
// rooms[code] = {
//   code, players: [socketId, socketId?], names: {socketId: name},
//   decks: {socketId: [{id,hp,atk}x3]}, hands: {socketId: 'rock'|'scissors'|'paper'},
//   started: bool, battleEnded: bool
// }
const rooms = {};
// クイックマッチ待機列: [{socketId, name}]
const quickQueue = [];

function makeRoomCode() {
  let code;
  do {
    code = String(Math.floor(1000 + Math.random() * 9000));
  } while (rooms[code]);
  return code;
}

function seatFor(room, socketId) {
  const idx = room.players.indexOf(socketId);
  return idx === 0 ? 'p1' : 'p2';
}

function otherPlayer(room, socketId) {
  return room.players.find((id) => id !== socketId);
}

function removeFromQueue(socketId) {
  const idx = quickQueue.findIndex((q) => q.socketId === socketId);
  if (idx !== -1) quickQueue.splice(idx, 1);
}

function cleanupRoom(code) {
  delete rooms[code];
}

// 相手に「退室しました」を通知するかどうか:
// 対戦が正常に終わった後の退室（battleEnded=true）は静かに片付けるだけ。
// 対戦中の切断だけ相手に知らせる。
function leaveRoom(socket, { silent = false } = {}) {
  const code = socket.data.roomId;
  if (!code) return;
  const room = rooms[code];
  if (room) {
    const opponentId = otherPlayer(room, socket.id);
    if (opponentId && !silent && !room.battleEnded) {
      io.to(opponentId).emit('opponent_left');
    }
    cleanupRoom(code);
  }
  socket.leave(code);
  socket.data.roomId = null;
}

io.on('connection', (socket) => {
  socket.data.roomId = null;

  socket.on('create_room', (data) => {
    try {
      const name = (data && data.name) || 'プレイヤー';
      const code = makeRoomCode();
      rooms[code] = {
        code,
        players: [socket.id],
        names: { [socket.id]: name },
        decks: {},
        hands: {},
        started: false,
        battleEnded: false,
      };
      socket.data.roomId = code;
      socket.join(code);
      socket.emit('room_created', { roomId: code });
    } catch (e) {
      console.error('[create_room]', e);
    }
  });

  socket.on('join_room', (data) => {
    try {
      const code = data && data.code;
      const name = (data && data.name) || 'プレイヤー';
      const room = rooms[code];
      if (!room) { socket.emit('join_error', { reason: 'ROOM_NOT_FOUND' }); return; }
      if (room.players.length >= 2) { socket.emit('join_error', { reason: 'ROOM_FULL' }); return; }
      if (room.started) { socket.emit('join_error', { reason: 'ALREADY_STARTED' }); return; }

      room.players.push(socket.id);
      room.names[socket.id] = name;
      socket.data.roomId = code;
      socket.join(code);

      const playersInfo = room.players.map((id) => ({ seat: seatFor(room, id), name: room.names[id] }));
      io.to(code).emit('lobby_update', { roomId: code, players: playersInfo });

      // 2人揃ったのでデッキ選択へ（各ソケットに自分視点の相手名を個別送信）
      room.players.forEach((id) => {
        const oppId = otherPlayer(room, id);
        io.to(id).emit('deck_select_start', {
          players: [
            { seat: seatFor(room, id), name: room.names[id] },
            { seat: seatFor(room, oppId), name: room.names[oppId] },
          ],
        });
      });
    } catch (e) {
      console.error('[join_room]', e);
    }
  });

  socket.on('quick_match', (data) => {
    try {
      const name = (data && data.name) || 'プレイヤー';
      removeFromQueue(socket.id); // 二重登録防止

      if (quickQueue.length > 0) {
        const partner = quickQueue.shift();
        // マッチ成立: 新しいルームを作って2人を入れる
        const code = makeRoomCode();
        rooms[code] = {
          code,
          players: [partner.socketId, socket.id],
          names: { [partner.socketId]: partner.name, [socket.id]: name },
          decks: {},
          hands: {},
          started: false,
          battleEnded: false,
        };
        const room = rooms[code];
        [partner.socketId, socket.id].forEach((id) => {
          const s = io.sockets.sockets.get(id);
          if (s) { s.data.roomId = code; s.join(code); }
        });
        room.players.forEach((id) => {
          const oppId = otherPlayer(room, id);
          io.to(id).emit('deck_select_start', {
            players: [
              { seat: seatFor(room, id), name: room.names[id] },
              { seat: seatFor(room, oppId), name: room.names[oppId] },
            ],
          });
        });
      } else {
        quickQueue.push({ socketId: socket.id, name });
        socket.emit('quick_match_waiting');
      }
    } catch (e) {
      console.error('[quick_match]', e);
    }
  });

  socket.on('cancel_quick_match', () => {
    removeFromQueue(socket.id);
  });

  socket.on('submit_deck', (data) => {
    try {
      const code = socket.data.roomId;
      const room = rooms[code];
      if (!room) return;
      // deck: [{id, hp, atk}, ...] — クライアントが計算済みのステータスをそのまま信頼する（リレー方式）
      room.decks[socket.id] = (data && data.deck) || [];

      if (room.players.length === 2 && room.players.every((id) => room.decks[id])) {
        room.started = true;
        room.players.forEach((id) => {
          const oppId = otherPlayer(room, id);
          io.to(id).emit('battle_start', {
            yourDeck: room.decks[id],
            opponentDeck: room.decks[oppId],
            opponentName: room.names[oppId],
          });
        });
      }
    } catch (e) {
      console.error('[submit_deck]', e);
    }
  });

  socket.on('submit_hand', (data) => {
    try {
      const code = socket.data.roomId;
      const room = rooms[code];
      if (!room) return;
      const hand = data && data.hand;
      if (!['rock', 'scissors', 'paper', 'ultimate'].includes(hand)) return;
      room.hands[socket.id] = hand;

      if (room.players.length === 2 && room.players.every((id) => room.hands[id])) {
        room.players.forEach((id) => {
          const oppId = otherPlayer(room, id);
          io.to(id).emit('turn_result', {
            yourHand: room.hands[id],
            opponentHand: room.hands[oppId],
          });
        });
        room.hands = {};
      }
    } catch (e) {
      console.error('[submit_hand]', e);
    }
  });

  // クライアントが自分のローカル計算で対戦の決着を検知したら送ってくる
  // （相手にも通知したいイベントは特にないが、退室時に「対戦中の切断」と
  // 区別して opponent_left を誤発火させないためのフラグ管理に使う）
  socket.on('report_battle_end', () => {
    const code = socket.data.roomId;
    const room = rooms[code];
    if (room) room.battleEnded = true;
  });

  socket.on('leave_room', () => {
    leaveRoom(socket);
  });

  socket.on('disconnect', () => {
    removeFromQueue(socket.id);
    leaveRoom(socket);
  });
});

server.listen(PORT, () => {
  console.log(`janken-battlers relay server listening on :${PORT}`);
});
