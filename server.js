const express = require('express');
const multer = require('multer');
const path = require('path');
const db = require('./database');
const app = express();
const port = 3001;



// Configuración de multer para el almacenamiento en memoria
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Middleware para servir archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));
app.use('/models', express.static(path.join(__dirname, 'public/models')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'))); // Añadir esta línea

// Middleware para manejar JSON y URL-encoded bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ruta para servir el archivo index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Ruta para obtener empresas
app.get('/get-empresas', (req, res) => {
    db.query("SELECT id, nombre FROM empresas", (err, rows) => {
        if (err) {
            console.error('Error leyendo la base de datos: ', err);
            res.status(500).json({ error: 'Error leyendo la base de datos' });
            return;
        }
        res.json(rows);
    });
});



// Ruta para verificar si ya hay una entrada registrada para hoy
app.get('/check-entry', (req, res) => {
    const { usuarioId, empresaId } = req.query;
    const query = `
        SELECT COUNT(*) AS count FROM registro
        WHERE usuario_id = ? AND empresa_id = ? AND DATE(hora_entrada) = CURDATE()
    `;
    db.query(query, [usuarioId, empresaId], (err, results) => {
        if (err) {
            console.error("Error al verificar la entrada: ", err);
            res.status(500).send('Error al verificar la entrada');
            return;
        }
        res.json({ entryExists: results[0].count > 0 });
    });
});

// Ruta para verificar si ya hay una salida registrada para hoy
app.get('/check-exit', (req, res) => {
    const { usuarioId, empresaId } = req.query;
    const query = `
        SELECT COUNT(*) AS count FROM registro
        WHERE usuario_id = ? AND empresa_id = ? AND DATE(hora_salida) = CURDATE() AND hora_salida IS NOT NULL
    `;
    db.query(query, [usuarioId, empresaId], (err, results) => {
        if (err) {
            console.error("Error al verificar la salida: ", err);
            res.status(500).send('Error al verificar la salida');
            return;
        }
        res.json({ exitExists: results[0].count > 0 });
    });
});


// Ruta para subir archivos y guardar datos en MySQL
app.post('/upload', upload.single('photo'), (req, res) => {
    const { name, cedula, cargo, empresaId } = req.body;
    const photo = req.file.buffer; // Imagen en buffer

    // Verificar si la cédula ya existe
    const checkQuery = "SELECT COUNT(*) AS count FROM tabla_usuarios WHERE cedula = ? AND codigo_empresa = ?";
    db.query(checkQuery, [cedula, empresaId], (err, results) => {
        if (err) {
            console.error("Error al verificar la cédula: ", err);
            res.status(500).send('Error verificando la cédula');
            return;
        }

        if (results[0].count > 0) {
            // Si la cédula ya existe, enviar mensaje de duplicado
            res.status(400).send('El usuario con esta cédula ya está registrado para esta empresa');
        } else {
            // Insertar nuevo usuario
            const insertQuery = "INSERT INTO tabla_usuarios (nombre, cedula, cargo, imagen, codigo_empresa) VALUES (?, ?, ?, ?, ?)";
            db.query(insertQuery, [name, cedula, cargo, photo, empresaId], (err, results) => {
                if (err) {
                    console.error("Error al insertar en la base de datos: ", err);
                    res.status(500).send('Error al insertar en la base de datos');
                    return;
                }
                res.send('Usuario agregado exitosamente');
            });
        }
    });
});

// Ruta para obtener los nombres de los usuarios sin paginación
app.get('/get-labels', (req, res) => {
    const empresaId = req.query.empresaId;

    const dataQuery = "SELECT nombre FROM tabla_usuarios WHERE codigo_empresa = ?";

    db.query(dataQuery, [empresaId], (err, rows) => {
        if (err) {
            res.status(500).send('Error leyendo la base de datos');
            return;
        }

        const labels = rows.map(row => row.nombre);
        res.json({ labels, totalUsers: labels.length });
    });
});

// Ruta para obtener la imagen de un usuario
app.get('/get-image', (req, res) => {
    const name = req.query.name;
    const empresaId = req.query.empresaId;
    const query = "SELECT imagen FROM tabla_usuarios WHERE nombre = ? AND codigo_empresa = ?";
    db.query(query, [name, empresaId], (err, results) => {
        if (err || results.length === 0) {
            res.status(404).send('Imagen no encontrada');
            return;
        }
        res.setHeader('Content-Type', 'image/jpeg');
        res.send(results[0].imagen);
    });
});

// Ruta para obtener los usuarios filtrados por empresa
app.get('/get-users', (req, res) => {
    const empresaId = req.query.empresaId;
    const query = "SELECT * FROM tabla_usuarios WHERE codigo_empresa = ?";
    db.query(query, [empresaId], (err, rows) => {
        if (err) {
            res.status(500).send('Error leyendo la base de datos');
            return;
        }
        res.json(rows);
    });
});

// Ruta para obtener el ID del usuario basado en el nombre y la empresa
app.get('/get-user-id', (req, res) => {
    const { name, empresaId } = req.query;
    const query = "SELECT id FROM tabla_usuarios WHERE nombre = ? AND codigo_empresa = ?";
    db.query(query, [name, empresaId], (err, results) => {
        if (err) {
            console.error("Error al obtener el ID del usuario: ", err);
            res.status(500).send('Error al obtener el ID del usuario');
            return;
        }
        if (results.length === 0) {
            res.status(404).send('Usuario no encontrado');
            return;
        }
        res.json({ id: results[0].id });
    });
});

// Ruta para registrar entrada
app.post('/register-entry', (req, res) => {
    const { usuarioId, empresaId, ubicacion, resultado_autenticacion, foto_intento } = req.body;
    const imageBuffer = foto_intento
        ? Buffer.from(foto_intento.split(',')[1], 'base64')
        : null;

    const q = `
        INSERT INTO registro
        (usuario_id, empresa_id, hora_entrada, ubicacion, resultado_autenticacion, foto_intento)
        SELECT ?, ?, NOW(), ?, ?, ?
        FROM DUAL
        WHERE NOT EXISTS (
            SELECT 1 FROM registro
            WHERE usuario_id = ?
              AND empresa_id = ?
              AND DATE(hora_entrada) = CURDATE()
        )
    `;
    const params = [
        usuarioId,
        empresaId,
        ubicacion,
        resultado_autenticacion,
        imageBuffer,
        usuarioId,
        empresaId
    ];

    db.query(q, params, (err, results) => {
        if (err) {
            console.error("Error al registrar la entrada:", err);
            return res.status(500).send("Error al registrar la entrada");
        }
        if (results.affectedRows === 0) {
            return res.status(409).send("Ya hay una entrada registrada para este usuario hoy.");
        }
        res.send("Entrada registrada exitosamente");
    });
});







// Ruta para registrar salida
app.post('/register-exit', (req, res) => {
    const { usuarioId, empresaId } = req.body;
    const q = `
    UPDATE registro
    SET hora_salida = NOW()
    WHERE usuario_id = ? 
      AND empresa_id = ? 
      AND DATE(hora_entrada) = CURDATE() 
      AND hora_salida IS NULL
  `;
    db.query(q, [usuarioId, empresaId], (err, results) => {
        if (err) {
            console.error("Error al registrar la salida:", err);
            return res.status(500).send("Error al registrar la salida");
        }
        if (results.affectedRows === 0) {
            return res.status(409).send("No se encontró una entrada válida para registrar la salida");
        }
        res.send("Salida registrada exitosamente");
    });
});



app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
}).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`El puerto ${port} ya está en uso. Por favor, usa otro puerto.`);
    } else {
        console.error(`Error al iniciar el servidor: ${err}`);
    }
});
