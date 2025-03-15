# Automatización de envios de mensaje desde Notion

A continuación encontrarás toda la información necesaria para **instalar**, **configurar** y **comprender** el funcionamiento de este script que interactúa con WhatsApp (a través de la librería **Baileys**) y con **Notion**. Esta guía está pensada para un desarrollador **principiante** que necesite utilizar el sistema sin conocimientos avanzados.

---

## Índice

1. [Introducción](#introducción)  
2. [Características Principales](#características-principales)  
3. [Requerimientos Previos](#requerimientos-previos)  
4. [Instalación y Puesta en Marcha](#instalación-y-puesta-en-marcha)  
5. [Estructura del Código](#estructura-del-código)  
6. [Explicación de Variables de Configuración (CONFIG)](#explicación-de-variables-de-configuración-config)  
7. [Clases Principales y sus Funciones](#clases-principales-y-sus-funciones)  
   1. [Clase Utils](#clase-utils)  
   2. [Clase NotionService](#clase-notionservice)  
   3. [Clase WhatsAppClient](#clase-whatsappclient)  
   4. [Clase NotionMonitor](#clase-notionmonitor)  
8. [Flujo General de la Aplicación](#flujo-general-de-la-aplicación)  
9. [Ejecución del Script](#ejecución-del-script)  
10. [Posibles Errores y Soluciones](#posibles-errores-y-soluciones)  
11. [Conclusiones](#conclusiones)

---

## Introducción

Este script está diseñado para **monitorizar** una base de datos de **Notion** y, ante nuevos registros que cumplan ciertas condiciones, **enviar mensajes de WhatsApp** de manera automatizada. Además, permite la interacción con los mensajes recibidos sin guardar información alguna en bases de datos externas, lo cual reduce la complejidad de la implementación.

Algunas de sus características clave son:

- **Conexión a WhatsApp** utilizando la librería [**Baileys**](https://github.com/WhiskeySockets/Baileys).
- **Intervalos de espera** para prevenir spam (2 minutos entre mensajes y 3 minutos entre ciclos de consulta a Notion).
- **Manipulación de números de teléfono** con reglas específicas para Argentina (prefijo 549) y México (prefijo 521).
- **Lectura y actualización** de propiedades en Notion:
  - Consulta de páginas que tengan **CONFIRMADO = true** y **INICIADO = false**.
  - Marcar la propiedad **INICIADO** como `true` una vez enviado el mensaje.
- **Sin uso de MongoDB** ni guardado de historiales de conversación.  
- **Código modular** y sencillo de mantener.

---

## Características Principales

- **Control de Sesión de WhatsApp**: se crean y gestionan las credenciales de la sesión en una carpeta específica.
- **Generación de Código QR**: para el escaneo desde el teléfono y la posterior conexión a WhatsApp Web.
- **Manejo de Errores de Conexión**: reconexión automática en caso de que se cierre la sesión de WhatsApp (a menos que sea un cierre por deslogueo explícito).
- **Filtro de Mensajes Recibidos**: solo se procesan aquellos que provengan de usuarios (excluye grupos).
- **Envío Secuencial de Mensajes**: con pausas de 2 minutos entre cada envío.
- **Monitoreo Cíclico de Notion**: se ejecuta cada 3 minutos para revisar nuevos registros.
- **Compatibilidad con Notion** mediante la librería oficial `@notionhq/client`.

---

## Requerimientos Previos

1. **Node.js**: Versión recomendada **14.17.0** en adelante (aunque se sugiere utilizar una versión LTS más reciente, por ejemplo la **16 o 18**).
2. **NPM o Yarn**: Para instalar las dependencias del proyecto.
3. **Cuenta en Notion** con el **API Key** correspondiente y un **Database ID** donde se gestionan los registros.
4. **Token de acceso a la API de Notion**: Debe ser un **token secreto** (con el prefijo `secret_`) proporcionado por Notion cuando configuras la integración.
5. **Permisos en Notion**: El token debe contar con acceso de lectura y escritura en la base de datos (database) que se quiere consultar y actualizar.

---

## Instalación y Puesta en Marcha

1. **Clonar o descargar** este repositorio donde se encuentra el script.
2. Desde la carpeta raíz del proyecto, ejecutar:
   ```bash
   npm install
