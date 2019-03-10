const axios = require('axios')
let response
const util = require('util')

/**
 *
 * Event doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html#api-gateway-simple-proxy-for-lambda-input-format
 * @param {Object} event - API Gateway Lambda Proxy Input Format
 *
 * Context doc: https://docs.aws.amazon.com/lambda/latest/dg/nodejs-prog-model-context.html
 * @param {Object} context
 *
 * Return doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html
 * @returns {Object} object - API Gateway Lambda Proxy Output Format
 *
 */
exports.lambdaHandler = async (event, context) => {
  let processed = []
  try {
    const body = JSON.parse(event.body)
    processed = await read(Array.isArray(body) ? body : [ body ])
  } catch (err) {
    console.log(err)
    return err
  }
  return processed
}

const read = async (urls) => {
  let results = []

  return Promise.all(
    urls.map(async url => {
      console.log('querying ' + url + ' ...')
      const ret = await axios(url)
      console.log('query ' + url + ' result is ' + ret.status)
      response = {
        'statusCode': 200,
        'body': JSON.stringify({
          url: url,
          modified: ret.headers['last-modified']
        })
      }
      results.push(response)
    })
  ).then(() => results)
}
