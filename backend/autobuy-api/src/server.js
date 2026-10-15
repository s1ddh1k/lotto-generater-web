import { createApp } from './app.js'

const server = createApp().listen(Number(process.env.PORT || 8080), () => {
  console.log(`lotto-autobuy-api listening on ${server.address().port}`)
})
process.on('SIGTERM', () => server.close())
