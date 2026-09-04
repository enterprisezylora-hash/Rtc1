<template>
  <div class="app-container">
    <el-form :model="queryParams" :inline="true" size="small" label-width="80px">
      <el-form-item label="命令类型">
        <el-input v-model="queryParams.commandType" clearable placeholder="如 screen / media" style="width: 180px" @keyup.enter.native="handleQuery" />
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="queryParams.status" clearable placeholder="全部" style="width: 140px">
          <el-option v-for="item in statusOptions" :key="item" :label="item" :value="item" />
        </el-select>
      </el-form-item>
      <el-form-item label="设备">
        <el-select v-model="queryParams.targetId" clearable filterable placeholder="全部" style="width: 220px">
          <el-option v-for="item in clientList" :key="item.id" :label="`${item.name} (${item.id})`" :value="item.id" />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" icon="el-icon-search" size="mini" @click="handleQuery">搜索</el-button>
        <el-button icon="el-icon-refresh" size="mini" @click="resetQuery">重置</el-button>
      </el-form-item>
    </el-form>

    <el-table v-loading="loading" :data="commandList" border>
      <el-table-column label="ID" prop="id" min-width="180" show-overflow-tooltip />
      <el-table-column label="设备" min-width="150">
        <template slot-scope="scope">
          {{ scope.row.device?.display_name || scope.row.device?.external_device_id || '-' }}
        </template>
      </el-table-column>
      <el-table-column label="命令" prop="command_type" min-width="120" />
      <el-table-column label="状态" width="110">
        <template slot-scope="scope">
          <el-tag :type="statusTagType(scope.row.status)" size="mini">{{ scope.row.status || '-' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="请求方" prop="requested_by" width="120" show-overflow-tooltip />
      <el-table-column label="请求时间" prop="requested_at" min-width="160" />
      <el-table-column label="发送时间" prop="sent_at" min-width="160" />
      <el-table-column label="ACK时间" prop="acked_at" min-width="160" />
      <el-table-column label="错误" prop="error_message" min-width="160" show-overflow-tooltip />
      <el-table-column label="载荷" min-width="220">
        <template slot-scope="scope">
          <el-popover placement="left" width="420" trigger="click">
            <pre style="max-height: 300px; overflow: auto; font-size: 12px">{{ formatPayload(scope.row.payload) }}</pre>
            <el-button slot="reference" size="mini" type="text">查看</el-button>
          </el-popover>
        </template>
      </el-table-column>
    </el-table>

    <pagination v-show="total > 0" :total="total" :page.sync="queryParams.pageNum" :limit.sync="queryParams.pageSize" @pagination="getList" />
  </div>
</template>

<script>
import { listClient } from '@/api/rco/client'
import { listCommandAudit } from '@/api/rco/control'

export default {
  name: 'RcoAudit',
  data() {
    return {
      loading: false,
      total: 0,
      clientList: [],
      commandList: [],
      statusOptions: ['pending', 'sent', 'acked', 'failed'],
      queryParams: {
        pageNum: 1,
        pageSize: 10,
        commandType: '',
        status: '',
        targetId: '',
      },
    }
  },
  created() {
    this.getList()
    this.getClientList()
  },
  methods: {
    getList() {
      this.loading = true
      listCommandAudit(this.queryParams)
        .then((response) => {
          this.commandList = response.rows || []
          this.total = response.total || 0
        })
        .finally(() => {
          this.loading = false
        })
    },
    getClientList() {
      listClient().then((response) => {
        this.clientList = response.rows || []
      })
    },
    handleQuery() {
      this.queryParams.pageNum = 1
      this.getList()
    },
    resetQuery() {
      this.queryParams = { pageNum: 1, pageSize: 10, commandType: '', status: '', targetId: '' }
      this.handleQuery()
    },
    statusTagType(status) {
      switch (status) {
        case 'acked':
          return 'success'
        case 'failed':
          return 'danger'
        case 'sent':
          return 'warning'
        default:
          return 'info'
      }
    },
    formatPayload(payload) {
      try {
        return JSON.stringify(payload, null, 2)
      } catch (e) {
        return String(payload)
      }
    },
  },
}
</script>
