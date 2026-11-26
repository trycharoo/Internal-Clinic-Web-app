import { createApiServer } from './server.ts'

const port = Number(process.env.PORT || 3000)

createApiServer().listen(port, '0.0.0.0', () => {
  console.log(`Clinic API listening on ${port}`)
})
