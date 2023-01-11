# Catenis API Emulator

This Node.js application is meant to be used for testing Catenis API clients.

# Installation

The application can be installed globally or under the project of the Catenis API client being tested.

To install it globally:

```shell
npm install -g catenis-api-client
```

To install it under the Catenis API client's project:

```shell
npm install --save-dev catenis-api-client
```

# Usage

When the application is run, two HTTP servers are started at the `localhost` address:
 - **API server**: this should be used in place of the actual Catenis API in the test cases of a Catenis API client.
 - **Command server**: used to control how the API serer should behave in relation to the received requests, via a
simple REST API.

For a list of the available command line options:

```shell
catenis-api-client --help
```

## Command REST API

### Add one or more Catenis device credentials

Method: **POST**

Path: `/device-credentials`

Body:

- A JSON adhering to the following schema:

```text
({
    deviceId: string,
    apiAccessSecret: string
} | [
    {
        deviceId: string,
        apiAccessSecret: string
    }
])
```

- Example (single device):

```json
{
  "deviceId": "drc3XdxNtzoucpw9xiRp",
  "apiAccessSecret": "4c1749c8e86f65e0a73e5fb19f2aa9e74a716bc22d7956bf3072b4bc3fbfe2a0d138ad0d4bcfee251e4e5f54d6e92b8fd4eb36958a7aeaeeb51e8d2fcc4552c3"
}
```

- Example (multiple devices):

```json
[
  {
    "deviceId": "drc3XdxNtzoucpw9xiRp",
    "apiAccessSecret": "4c1749c8e86f65e0a73e5fb19f2aa9e74a716bc22d7956bf3072b4bc3fbfe2a0d138ad0d4bcfee251e4e5f54d6e92b8fd4eb36958a7aeaeeb51e8d2fcc4552c3"
  },
  {
    "deviceId": "d8YpQ7jgPBJEkBrnvp58",
    "apiAccessSecret": "267a687115b9752f2eec5be849b570b29133528f928868d811bad5e48e97a1d62d432bab44803586b2ac35002ec6f0eeaa98bec79b64f2f69b9cb0935b4df2c4"
  }
]
```

### Retrieve the current Catenis device credentials

Method: **GET**

Path: `/device-credentials`

### Set the HTTP context

Method: **POST**

Path: `/http-context`

Body:

- A JSON adhering to the following schema:

```text
{
    expectedRequest: {
        httpMethod: ('GET' | 'POST'),
        apiMethodPath: string,
        headers?: Object<string, (string | null)>,
        data?: string, /* JSON */
        authenticate: boolean
    },
    requiredResponse?: ({
        data: string /* JSON */
    } | {
        statusCode: Number,
        errorMessage?: String
    })
}
```

- Example (success response):

```json
{
  "expectedRequest": {
    "httpMethod": "POST",
    "apiMethodPath": "messages/log",
    "data": "{\"message\":\"Test message #1\"}",
    "authenticate": true
  },
  "requiredResponse": {
    "data": "{\"messageId\":\"mdx8vuCGWdb2TFeWFZd6\"}"
  }
}
```

- Example (error response):

```json
{
  "expectedRequest": {
    "httpMethod": "POST",
    "apiMethodPath": "messages/log",
    "data": "{\"message\":\"This is another test message\"}",
    "authenticate": true
  },
  "requiredResponse": {
    "statusCode": 400,
    "errorMessage": "Not enough credits to pay for log message service"
  }
}
```

- Example (request with data compression):

```json
{
  "expectedRequest": {
    "httpMethod": "POST",
    "apiMethodPath": "messages/log",
    "headers": {
      "Content-Encoding": "deflate"
    },
    "data": "{\"message\":\"This is a long message, long enough to make sure that it will be compressed before being sent. If it is not long enough, the message will not be compressed.\"}",
    "authenticate": true
  },
  "requiredResponse": {
    "data": "{\"messageId\":\"mBQjBLCATBrRxST3Gu4F\"}"
  }
}
```

### Retrieve the current HTTP context

Method: **GET**

Path: `/http-context`

### Set the WebSocket notification context

Method: **POST**

Path: `/notify-context`

Body:

- A JSON adhering to the following schema:

```text
Object<string, Object<string, {
  data: string, /* JSON */
  timeout?: number
}>>
```

Where the `key` of the outer dictionary is a Catenis virtual device ID, and the `key` of the inner dictionary is a
Catenis notification event.

- Example:

```json
{
  "drc3XdxNtzoucpw9xiRp": {
    "new-msg-received": {
      "data": "{\"messageId\":\"mNEWqgSMAeDAmBAkBDWr\",\"from\":{\"deviceId\":\"dnN3Ea43bhMTHtTvpytS\",\"name\":\"deviceB\",\"prodUniqueId\":\"XYZABC001\"},\"receivedDate\":\"2018-01-29T23:27:39.657Z\"}",
      "timeout": 5
    }
  }
}
```

### Retrieve the current WebSocket notification context

Method: **GET**

Path: `/notify-context`

### Close all WebSocket notification channels

Method: **POST**

Path: `/notify-close`

Body: none

### Retrieve application info

Method: **GET**

Path: `/info`

### Close the application

Method: **POST**

Path: `/close`

Body: none

## License

This application is released under the [MIT License](LICENSE). Feel free to fork, and modify!

Copyright © 2023, Blockchain of Things Inc.
