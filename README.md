<div align="center">

<img src="https://raw.githubusercontent.com/Mingo20/dtech/main/assets/brand/dg-logo-512.png" width="84" alt="DGTech" />

# Delega IA · Asistente Docente

**Asistente IA para docentes dominicanos: planificaciones, asistencia, calificaciones, rúbricas y notas de voz.**

![Versión](https://img.shields.io/badge/versión-1.0.0-FF6A13?style=flat-square) ![Estado](https://img.shields.io/badge/estado-Producción-2EA44F?style=flat-square) ![Tipo](https://img.shields.io/badge/tipo-PWA_%2B_servidor_Node-0B2545?style=flat-square) ![DGTech](https://img.shields.io/badge/by-DGTech-FF6A13?style=flat-square)

[**Abrir la aplicación**](https://mingo20.github.io/agentia/) · [Hub DGTech](https://mingo20.github.io/dtech/) · [Guía para agentes](AGENTS.md) · [Cambios](CHANGELOG.md)

<img src="https://raw.githubusercontent.com/Mingo20/dtech/main/assets/shots/agentia.jpg" alt="Delega IA · Asistente Docente" width="720" />

</div>

## El problema

Reducir la carga administrativa del docente.

## Qué hace

- Notas de voz inteligentes
- Planificaciones oficiales
- Registro de asistencia
- Calificaciones y boletines
- Rúbricas de evaluación
- Chat con IA integrado
- Documentos recientes

## Cómo está construido

**Tipo:** PWA + servidor Node

La PWA llama a delegaIA y el servidor Node gestiona archivos de Google Drive.

**Tecnologías**

- PWA (app.html)
- Servidor Node en server/ con integración a Google Drive
- Despliegue en Render (render.yaml)
- Función delegaIA en Base44

**Backend**

- delegaIA (Base44)
- server/server.js (Node)

**Datos**

- Sesión y documentos del docente

## Datos sensibles

Datos de docentes y estudiantes.

## Reglas del proyecto

- Seguir el currículo oficial vigente

## Pendientes conocidos

- Documentar las variables de server/.env.example

## Estructura del repositorio

Consulta [AGENTS.md](AGENTS.md) para el mapa de archivos y las instrucciones de trabajo.

## Parte de DGTech

Este proyecto forma parte del ecosistema **DGTech**, un estudio de software dominicano que construye aplicaciones instalables para resolver problemas reales. Todas las aplicaciones están en [https://mingo20.github.io/dtech/](https://mingo20.github.io/dtech/).

---

<sub>© 2026 DGTech · Domingo Guerra · Todos los derechos reservados. Consulta el archivo NOTICE.</sub>
