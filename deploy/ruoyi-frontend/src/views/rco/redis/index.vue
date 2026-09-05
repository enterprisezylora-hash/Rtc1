<template>
  <div class="app-container">
    <el-row :gutter="10" class="mb8">
      <el-col :span="1.5">
        <el-button type="primary" plain icon="el-icon-refresh" size="mini" :loading="loading" @click="refreshAll">刷新</el-button>
      </el-col>
      <el-col :span="1.5">
        <el-switch v-model="autoRefresh" active-text="自动刷新 (10s)" @change="toggleAuto" />
      </el-col>
    </el-row>

    <el-row :gutter="20">
      <el-col :span="12">
        <el-card shadow="hover">
          <div slot="header"><b>Redis 健康</b></div>
          <el-descriptions v-if="health" :column="1" border size="small">
            <el-descriptions-item label="Enabled">
              <el-tag :type="health.enabled ? 'success' : 'info'" size="mini">{{ health.enabled }}</el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="Ready">
              <el-tag :type="health.ready ? 'success' : 'danger'" size="mini">{{ health.ready }}</el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="URL">{{ health.url || '-' }}</el-descriptions-item>
            <el-descriptions-item label="Cluster Channel">{{ health.clusterChannel || '-' }}</el-descriptions-item>
            <el-descriptions-item label="Status Channel">{{ health.statusChannel || '-' }}</el-descriptions-item>
          </el-descriptions>
          <el-empty v-else description="暂无数据" />
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card shadow="hover">
          <div slot="header"><b>队列统计</b></div>
          <el-descriptions v-if="stats" :column="1" border size="small">
            <el-descriptions-item label="Ready">
              <el-tag :type="stats.ready ? 'success' : 'danger'" size="mini">{{ stats.ready }}</el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="Mode">{{ stats.mode || '-' }}</el-descriptions-item>
            <el-descriptions-item :label="`Stream (${stats.stats?.streamKey || '-'})`">{{ stats.stats?.streamLength ?? '-' }}</el-descriptions-item>
            <el-descriptions-item :label="`List (${stats.stats?.listKey || '-'})`">{{ stats.stats?.listLength ?? '-' }}</el-descriptions-item>
            <el-descriptions-item label="Snapshot Cache">
              <el-tag :type="stats.stats?.snapshotCacheExists ? 'success' : 'info'" size="mini">{{ !!stats.stats?.snapshotCacheExists }}</el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="Health Cache">
              <el-tag :type="stats.stats?.healthCacheExists ? 'success' : 'info'" size="mini">{{ !!stats.stats?.healthCacheExists }}</el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="检查时间">{{ stats.checkedAt || '-' }}</el-descriptions-item>
          </el-descriptions>
          <el-empty v-else description="暂无数据" />
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script>
import { getRedisHealth, getRedisQueueStats } from '@/api/rco/redis'

export default {
  name: 'RcoRedis',
  data() {
    return {
      loading: false,
      autoRefresh: false,
      timer: null,
      health: null,
      stats: null,
    }
  },
  created() {
    this.refreshAll()
  },
  beforeDestroy() {
    this.stopTimer()
  },
  methods: {
    refreshAll() {
      this.loading = true
      Promise.all([getRedisHealth(), getRedisQueueStats()])
        .then(([healthRes, statsRes]) => {
          this.health = healthRes.data || healthRes
          this.stats = statsRes.data || statsRes
        })
        .finally(() => {
          this.loading = false
        })
    },
    toggleAuto(enabled) {
      this.stopTimer()
      if (enabled) {
        this.timer = setInterval(this.refreshAll, 10000)
      }
    },
    stopTimer() {
      if (this.timer) {
        clearInterval(this.timer)
        this.timer = null
      }
    },
  },
}
</script>
