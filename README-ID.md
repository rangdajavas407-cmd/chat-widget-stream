# 🦉 ChatWidget Studio — tiktok and yt

Selamat datang di **ChatWidget Studio**, sebuah *live chat overlay* interaktif yang dirancang khusus untuk streamer TikTok & YouTube. Aplikasi ini menggabungkan konektor *real-time*, editor visual (WYSIWYG), dan render engine CSS canggih untuk mempercantik tampilan chat di OBS atau layar siaran.

**Created by:** `ranbyus.exe`

---

## 🚀 Panduan Instalasi (Windows)

1. Ekstrak folder aplikasi ini.
2. Pastikan **Node.js versi LTS** sudah terpasang di komputermu.
3. Buka Terminal / CMD, lalu arahkan ke folder aplikasi ini.
4. Jalankan perintah: `npm install` (tunggu hingga selesai).
5. Jalankan perintah: `npm start`.
6. Buka browser dan akses: `http://localhost:3000/`.

*(Catatan: Saat server menyala, sistem akan mencoba terhubung otomatis ke `@veroeugolius`. Jika akun sedang offline, server tetap hidup. Kamu bisa menghubungkan akun lain secara manual lewat halaman Connector setelah akun tersebut LIVE).*

---

## 🌐 Struktur URL & Cara Kerja Aplikasi

Aplikasi ini berjalan di atas Node.js dan menggunakan WebSocket untuk komunikasi *real-time* antara server, konektor, editor, dan overlay OBS.

- **Connector (`http://localhost:3000/`)** 
  Halaman ini berfungsi sebagai pusat kendali koneksi. Di sini kamu memasukkan username TikTok atau URL/ID YouTube yang sedang LIVE. Koneksi akan dijembatani oleh library `tiktok-live-connector` dan `youtubei.js`.
- **Editor (`http://localhost:3000/editor`)** 
  Ini adalah studio desainmu. Kamu bisa mengatur bentuk *bubble*, warna, ornamen, hingga custom CSS. Setiap perubahan di editor akan langsung dikirim ke *display* (OBS) via WebSocket.
- **Overlay / Display (`http://localhost:3000/display`)** 
  Halaman transparan ini yang dimasukkan ke dalam **OBS Browser Source**. Engine di halaman ini mengambil data CSS & JS secara langsung dari *editor.html*, memastikan tampilan OBS 100% sama dengan yang kamu desain.
- **Status JSON (`http://localhost:3000/status`)** 
  Endpoint ini berguna untuk *monitoring*. Jika kamu punya *dashboard* atau *bot* lain, kamu bisa mengecek status koneksi (TikTok/YouTube) melalui URL ini.

---

## 🎨 Panel Editor

Editor dibagi menjadi beberapa tab khusus untuk mempermudah kustomisasi:

- **Burung Hantu**: Pengaturan inti. Mengatur bentuk bubble, warna dasar, ukuran font, hingga input *Chat Code* & *Custom CSS*.
- **Agent**: Khusus untuk *role* pengguna TikTok (seperti Moderator, Top Gifter, Fans Club) beserta ornamen/badge khusus.
- **Art**: Pengaturan *role* untuk pengguna YouTube (seperti Super Chat, Member, Subscriber) beserta stylenya.
- **3D**: Pratinjau 3D CSS ringan dengan kontrol rotasi, skala, dan latar. *(Catatan: Fitur ini adalah efek visual CSS, bukan viewer model VRM/GLB).*

---

## 📜 Peraturan & Ketentuan Penggunaan (Terms of Use)

Sebelum menggunakan aplikasi ini, harap patuhi peraturan berikut:

1. **Koneksi LIVE:** Status `connected` pada sistem hanya menandakan bahwa *connector* berhasil masuk ke *room*. Badge/role pada chat baru akan muncul setelah event chat benar-benar masuk dari server TikTok/YouTube.
2. **Dukungan Platform:** Saat ini aplikasi hanya mendukung **TikTok** dan **YouTube**. Integrasi Twitch dan Instagram **belum diaktifkan** di server asal.
3. **OBS Browser Source:** Wajib menggunakan URL `http://localhost:3000/display` di OBS. **Jangan** membuka file HTML secara lokal (langsung klik file), karena kamu tidak akan menerima event LIVE melalui WebSocket.
4. **Ketergantungan Sistem:** Aplikasi ini bergantung pada `viewer-khusus.js` sebagai *helper* role ringan. Pastikan file tersebut tidak terhapus dan tetap berada di direktori server.

---

## ⚠️ Peringatan Keras & Hak Cipta

**DILARANG KERAS** memasukkan hasil kodingan apa pun dari proyek ini ke dalam AI (Artificial Intelligence) untuk dimodifikasi, dilatih (feed), atau diakui sebagai hasil karya AI.

Aplikasi dan seluruh sistem di dalamnya adalah **versi proper (final)** yang dibuat dan dikunci oleh **`ranbyus.exe`**. 

Segala bentuk perubahan, penghapusan, atau klaim sepihak tanpa izin dari pembuat asli sangat dilarang. Harap hargai karya pembuatnya.

---
*Dibuat dengan oleh ranbyus.exe*